pragma solidity 0.4.24;

import "./ETOTimedStateMachine.sol";
import "./ETOTerms.sol";
import "../Universe.sol";
import "../Company/IEquityToken.sol";
import "../ICBM/LockedAccount.sol";
import "../AccessControl/AccessControlled.sol";
import "../Agreement.sol";
import "../Reclaimable.sol";
import "../Math.sol";
import "../Serialization.sol";


/// @title represents token offering organized by Company
///  token offering goes through states as defined in ETOTimedStateMachine
///  setup phase requires several parties to provide documents and information
///   (deployment (by anyone) -> eto terms (company) -> RAAA agreement (nominee) -> adding to universe (platform) + issue NEU -> start date (company))
///   whitelist may be added when RAAA and eto terms are present
/// todo: review all divisions for rounding errors
contract ETOCommitment is
    AccessControlled,
    Agreement,
    ETOTimedStateMachine,
    Reclaimable,
    IdentityRecord,
    Math,
    Serialization
{

    ////////////////////////
    // Types
    ////////////////////////

    /// @notice state of individual investment
    /// @dev mind uint size: allows ticket to occupy two storage slots
    struct InvestmentTicket {
        // euro equivalent of both currencies.
        //  for ether equivalent is generated per ETH/EUR spot price provided by ITokenExchangeRateOracle
        uint96 equivEurUlps;
        // NEU reward issued
        uint96 rewardNmkUlps;
        // Equity Tokens issued, no precision
        uint96 equityTokenInt;
        // total Ether invested
        uint96 amountEth;
        // total Euro invested
        uint96 amountEurUlps;
        // claimed or refunded
        bool claimOrRefundSettled;
        // locked account was used
        bool usedLockedAccount;
        // uint30 reserved // still some bits free
    }

    // todo: implement whitelisting with discounts
    /* struct WhitelistTicket {
        uint128 maxTicketOverrideEurUlps,
        uint128 fixedDiscountOverrideFrac
    } */

    ////////////////////////
    // Constants state
    ////////////////////////

    // bytes32 private constant EMPTY_STRING_HASH = keccak256("");

    ////////////////////////
    // Immutable state
    ////////////////////////

    // a root of trust contract
    Universe private UNIVERSE;
    // NEU tokens issued as reward for investment
    Neumark private NEUMARK;
    // ether token to store and transfer ether
    IERC223Token private ETHER_TOKEN;
    // euro token to store and transfer euro
    IERC223Token private EURO_TOKEN;
    // allowed icbm investor accounts
    LockedAccount private ETHER_LOCK;
    LockedAccount private EURO_LOCK;
    // equity token issued
    IEquityToken private EQUITY_TOKEN;
    // wallet registry of KYC procedure
    IIdentityRegistry private IDENTITY_REGISTRY;
    // currency rate oracle
    ITokenExchangeRateOracle private CURRENCY_RATES;

    // max cap taken from ETOTerms for low gas costs
    uint256 private MIN_NUMBER_OF_TOKENS;
    // min cap taken from ETOTerms for low gas costs
    uint256 private MAX_NUMBER_OF_TOKENS;
    // maximum ticket from ETOTerms for low gas costs
    uint256 private MAX_TICKET_EUR_ULPS;
    // minimum ticket from ETOTerms for low gas costs
    uint256 private MIN_TICKET_EUR_ULPS;
    // minimum ticket in tokens with base price
    uint256 private MIN_TICKET_TOKENS;
    // platform operator share for low gas costs
    uint256 private PLATFORM_NEUMARK_SHARE;

    // wallet that keeps Platform Operator share of neumarks
    //  and where token participation fee is temporarily stored
    address private PLATFORM_WALLET;
    // company representative address
    address private COMPANY_LEGAL_REPRESENTATIVE;
    // nominee address
    address private NOMINEE;

    // terms contracts
    ETOTerms private ETO_TERMS;
    // reference to platform terms
    ETOPlatformTerms public PLATFORM_TERMS;

    ////////////////////////
    // Mutable state
    ////////////////////////

    // mapping of investors allowed in whitelist
    mapping (address => bool) private _whitelist;
    // corresponding iterator
    address[] private _whitelistInvestors;

    // investment tickets
    mapping (address => InvestmentTicket) private _tickets;

    // total investment in euro equivalent (ETH converted on spot prices)
    uint128 private _totalEquivEurUlps;

    // total equity tokens acquired
    uint128 private _totalTokensInt;

    // signed investment agreement url
    string private _signedInvestmentAgreementUrl;

    // nominee investment agreement url confirmation hash
    bytes32 private _nomineeSignedInvestmentAgreementUrlHash;

    // successful ETO bookeeping
    // amount of new shares generated
    uint96 private _newShares;
    // how many equity tokens goes to platform portfolio as a fee
    uint96 private _tokenParticipationFeeInt;
    // platform fee in eth
    uint96 private _platformFeeEth;
    // platform fee in eur
    uint96 private _platformFeeEurUlps;
    // additonal contribution (investment amount) eth
    uint96 private _additionalContributionEth;
    // additonal contribution (investment amount) eur
    uint96 private _additionalContributionEurUlps;

    ////////////////////////
    // Modifiers
    ////////////////////////

    modifier onlyCompany() {
        require(msg.sender == COMPANY_LEGAL_REPRESENTATIVE);
        _;
    }

    modifier onlyNominee() {
        require(msg.sender == NOMINEE);
        _;
    }

    modifier onlyWithTerms() {
        require(ETO_TERMS != address(0));
        _;
    }

    modifier onlyWithAgreement {
        require(amendmentsCount() > 0);
        _;
    }

    ////////////////////////
    // Events
    ////////////////////////

    // logged at the moment contract is deployed
    event LogETOCommitmentDeployed(
        address deployer,
        address platformTerms,
        address nominee,
        address companyLegalRep
    );

    // logged at the moment of Company setting terms
    event LogTermsSet(
        address companyLegalRep,
        address etoTerms,
        address equityToken
    );

    // logged at the moment Company sets/resets Whitelisting start date
    event LogETOStartDateSet(
        address companyLegalRep,
        uint256 previousTimestamp,
        uint256 newTimestamp
    );

    // logged at the moment Signing procedure starts
    event LogSigningStarted(
        address nominee,
        address companyLegalRep,
        uint256 newShares,
        uint256 capitalIncreaseEurUlps
    );

    // logged when company presents signed investment agreement
    event LogCompanySignedAgreement(
        address companyLegalRep,
        address nominee,
        string signedInvestmentAgreementUrl
    );

    // logged when nominee presents and verifies its copy of investment agreement
    event LogNomineeConfirmedAgreement(
        address nominee,
        address companyLegalRep,
        bytes32 hash
    );

    // logged on claim state transition indicating that additional contribution was released to company
    event LogAdditionalContribution(
        address companyLegalRep,
        address paymentToken,
        uint256 amount
    );

    // logged on claim state transition indicating NEU reward available
    event LogPlatformNeuReward(
        uint256 totalRewardNmkUlps,
        uint256 platformRewardNmkUlps
    );

    // logged on payout transition to mark cash payout to NEU holders
    event LogPlatformFeePayout(
        address disbursalPool,
        address paymentToken,
        uint256 amount
    );

    // logged on payout transition to mark equity token payout to portfolio smart contract
    event LogPlatformPortfolioPayout(
        address platformPortfolio,
        address assetToken,
        uint256 amount
    );

    // logged on refund transition to mark destroyed tokens
    event LogRefundStarted(
        address assetToken,
        uint256 totalTokenAmountInt,
        uint256 totalRewardNmkUlps
    );

    ////////////////////////
    // Constructor
    ////////////////////////

    /// anyone may be a deployer, the platform acknowledges the contract by adding it to Universe Commitment collection
    constructor(
        Universe universe,
        address platformWallet,
        address nominee,
        address companyLegalRep
    )
        Agreement(universe.accessPolicy(), universe.forkArbiter())
        ETOTimedStateMachine()
        public
    {
        UNIVERSE = universe;
        PLATFORM_TERMS = ETOPlatformTerms(universe.platformTerms());
        PLATFORM_WALLET = platformWallet;
        COMPANY_LEGAL_REPRESENTATIVE = companyLegalRep;
        NOMINEE = nominee;
        PLATFORM_NEUMARK_SHARE = PLATFORM_TERMS.PLATFORM_NEUMARK_SHARE();

        NEUMARK = universe.neumark();
        ETHER_TOKEN = universe.etherToken();
        EURO_TOKEN = universe.euroToken();
        ETHER_LOCK = LockedAccount(universe.etherLock());
        EURO_LOCK = LockedAccount(universe.euroLock());
        IDENTITY_REGISTRY = IIdentityRegistry(universe.identityRegistry());
        CURRENCY_RATES = ITokenExchangeRateOracle(universe.tokenExchangeRateOracle());

        emit LogETOCommitmentDeployed(msg.sender, address(PLATFORM_TERMS), nominee, companyLegalRep);
    }

    ////////////////////////
    // External functions
    ////////////////////////

    function setTerms(
        ETOTerms etoTerms,
        IEquityToken equityToken
    )
        external
        onlyCompany
        onlyWithAgreement
        withStateTransition()
        onlyState(ETOState.Setup)
    {
        require(equityToken.decimals() == PLATFORM_TERMS.EQUITY_TOKENS_PRECISION(), "ETO_ET_DECIMALS");
        require(equityToken.tokensPerShare() == PLATFORM_TERMS.EQUITY_TOKENS_PER_SHARE(), "ETO_ET_TPS_NE");
        require(equityToken.shareNominalValueEurUlps() == etoTerms.SHARE_NOMINAL_VALUE_EUR_ULPS(), "ETO_ET_SNV");
        // todo: check if signed by the same nominee
        etoTerms.requireValidTerms(PLATFORM_TERMS);

        ETO_TERMS = etoTerms;
        EQUITY_TOKEN = equityToken;

        MAX_NUMBER_OF_TOKENS = etoTerms.MAX_NUMBER_OF_TOKENS();
        MIN_NUMBER_OF_TOKENS = etoTerms.MIN_NUMBER_OF_TOKENS();
        MAX_TICKET_EUR_ULPS = etoTerms.MAX_TICKET_EUR_ULPS();
        MIN_TICKET_EUR_ULPS = etoTerms.MIN_TICKET_EUR_ULPS();
        MIN_TICKET_TOKENS = divRound(MIN_TICKET_EUR_ULPS, etoTerms.TOKEN_PRICE_EUR_ULPS());

        setupStateMachine(
            ETO_TERMS.DURATION_TERMS(),
            IETOCommitmentObserver(EQUITY_TOKEN.equityTokenController())
        );

        emit LogTermsSet(msg.sender, address(etoTerms), address(equityToken));
    }

    function addWhitelisted(address[] investors)
        external
        onlyCompany
        onlyWithTerms
        withStateTransition()
        onlyState(ETOState.Setup)
    {
        // TODO: implemement
    }

    function removeWhitelisted(address[] investors)
        external
        onlyCompany
        onlyWithTerms
        withStateTransition()
        onlyState(ETOState.Setup)
    {
        // TODO: implemement
    }

    /// @dev used by PLATFORM_LEGAL_REP to kill commitment process before it starts
    /// @dev selfdestruct is executed
    function abort()
        external
        only(ROLE_PLATFORM_OPERATOR_REPRESENTATIVE)
        withStateTransition()
        onlyState(ETOState.Setup)
    {
        selfdestruct(msg.sender);
    }

    /// @dev sets timed state machine in motion,
    function setStartDate(uint256 startDate)
        external
        onlyCompany
        onlyWithTerms
        withStateTransition()
        onlyState(ETOState.Setup)
    {
        // todo: check if in universe
        // todo: check if can issue neumark
        assert(startDate < 0xFFFFFFFF);
        // must be less than 3 days (platform terms!)
        require(
            startDate < block.timestamp && block.timestamp - startDate < PLATFORM_TERMS.DATE_TO_WHITELIST_MIN_DURATION(),
            "ETO_DATE_TOO_EARLY");
        // prevent re-setting of old date within
        uint256 startAt = startOfInternal(ETOState.Whitelist);
        require(startAt == 0 || block.timestamp - startAt > PLATFORM_TERMS.DATE_TO_WHITELIST_MIN_DURATION(), "ETO_DATE_TOO_LATE");
        runStateMachine(uint32(startDate));

        emit LogETOStartDateSet(msg.sender, startAt, startDate);
    }

    function companySignsInvestmentAgreement(string signedInvestmentAgreementUrl)
        external
        withStateTransition()
        onlyState(ETOState.Signing)
        onlyCompany
    {
        _signedInvestmentAgreementUrl = signedInvestmentAgreementUrl;
        emit LogCompanySignedAgreement(msg.sender, NOMINEE, signedInvestmentAgreementUrl);
    }

    function nomineeConfirmsInvestmentAgreement(string signedInvestmentAgreementUrl)
        external
        withStateTransition()
        onlyState(ETOState.Signing)
        onlyNominee
    {
        bytes32 nomineeHash = keccak256(abi.encodePacked(signedInvestmentAgreementUrl));
        require(keccak256(abi.encodePacked(_signedInvestmentAgreementUrl)) == nomineeHash, "INV_HASH");
        _nomineeSignedInvestmentAgreementUrlHash = nomineeHash;
        emit LogNomineeConfirmedAgreement(msg.sender, COMPANY_LEGAL_REPRESENTATIVE, nomineeHash);
    }

    //
    // Implements ICommitment
    //

    /// commit function happens via ERC223 callback that must happen from trusted payment token
    /// @dev data in case of LockedAccount contains investor address and investor is LockedAccount address
    function tokenFallback(address investorOrProxy, uint256 amount, bytes data)
        public
        withStateTransition()
        onlyStates(ETOState.Whitelist, ETOState.Public)
    {
        // we trust only tokens below
        require(msg.sender == address(ETHER_TOKEN) || msg.sender == address(EURO_TOKEN));
        // check if LockedAccount
        bool isLockedAccount = (investorOrProxy == address(ETHER_LOCK) || investorOrProxy == address(EURO_LOCK));
        address investor = investorOrProxy;
        if (isLockedAccount) {
            // data contains investor address
            // todo: how to encode maximum price here?
            investor = addressFromBytes(data); // solium-disable-line security/no-assign-params
        }
        // agreement accepted by act of reserving funds in this function
        acceptAgreementInternal(investor);
        // kick out not whitelist or not LockedAccount
        // todo: IS_ICBM_INVESTOR_WHITELISTED
        if (state() == ETOState.Whitelist) {
            require(_whitelist[investor] || isLockedAccount);
        }
        // kick out on KYC
        IdentityClaims memory claims = deserializeClaims(IDENTITY_REGISTRY.getClaims(investor));
        require(claims.isVerified && !claims.accountFrozen);
        // process ticket
        uint96 equityTokenInt;
        uint96 rewardNmkUlps;
        uint96 equivEurUlps;
        (equityTokenInt, rewardNmkUlps, equivEurUlps) = processTicket(investor, amount, isLockedAccount);
        // update total investment
        _totalEquivEurUlps += equivEurUlps;
        _totalTokensInt += equityTokenInt;
        // log successful commitment
        emit LogFundsCommitted(
            investor,
            msg.sender,
            amount,
            equivEurUlps,
            equityTokenInt,
            EQUITY_TOKEN,
            rewardNmkUlps
        );
    }

    //
    // Implements IETOCommitment
    //

    function claim()
        external
        withStateTransition()
        onlyStates(ETOState.Claim, ETOState.Payout)

    {
        claimTokensPrivate(msg.sender);
    }

    function claimMany(address[] investors)
        external
        withStateTransition()
        onlyStates(ETOState.Claim, ETOState.Payout)
    {
        // todo: claim in a loop
    }

    function refund()
        external
        withStateTransition()
        onlyState(ETOState.Refund)

    {
        refundTokensPrivate(msg.sender);
    }

    function refundMany(address[] investors)
        external
        withStateTransition()
        onlyState(ETOState.Refund)
    {
        // todo: refund in a loop
    }

    function payout()
        external
        withStateTransition()
        onlyState(ETOState.Payout)
    {
        // does nothing - all hapens in state transition
    }

    //
    // Getters
    //

    function estimateTokensAndNmkReward(uint256 amountEurUlps)
        public
        constant
        returns (uint256 tokenAmountInt, uint256 rewardNmkUlps)
    {
        uint256 rewardNmk = NEUMARK.incremental(amountEurUlps);
        (, rewardNmkUlps) = calculateNeumarkDistribution(rewardNmk);
        tokenAmountInt = ETO_TERMS.calculateTokenAmount(_totalEquivEurUlps, amountEurUlps);
    }

    function investorTicket(address investor)
        public
        constant
        returns (uint256 maxTicket, uint256 discountFrac)
    {
        // TODO: implement ticket size depending in KYC (0, soph, normal)
        // check whitelist and provide overrides
    }

    //
    // IETOCommitment getters
    //

    function signedInvestmentAgreementUrl()
        public
        constant
        returns (string)
    {
        require(_nomineeSignedInvestmentAgreementUrlHash != bytes32(0));
        return _signedInvestmentAgreementUrl;
    }

    function signedOfferingResults()
        public
        constant
        returns (
            uint256 newShares, uint256 capitalIncreaseEurUlps,
            uint256 additionalContributionEth, uint256 additionalContributionEurUlps,
            uint256 tokenParticipationFeeInt, uint256 platformFeeEth, uint256 platformFeeEurUlps
        )
    {
        return (
            _newShares, _newShares * EQUITY_TOKEN.shareNominalValueEurUlps(),
            _additionalContributionEth, _additionalContributionEurUlps,
            _tokenParticipationFeeInt, _platformFeeEth, _platformFeeEurUlps
        );
    }

    function etoTerms() public constant returns (ETOTerms) {
        return ETO_TERMS;
    }

    function platformTerms() public constant returns (ETOPlatformTerms) {
        return PLATFORM_TERMS;
    }

    function equityToken() public constant returns (IEquityToken) {
        return EQUITY_TOKEN;
    }

    function identityRegistry() public constant returns (IIdentityRegistry) {
        return IDENTITY_REGISTRY;
    }

    function nominee() public constant returns (address) {
        return NOMINEE;
    }

    function companyLegalRep() public constant returns (address) {
        return COMPANY_LEGAL_REPRESENTATIVE;
    }

    ////////////////////////
    // Internal functions
    ////////////////////////

    //
    // Overrides internal interface
    //

    function mAdavanceLogicState(ETOState oldState)
        internal
        constant
        returns (ETOState)
    {
        if (oldState == ETOState.Whitelist || oldState == ETOState.Public) {
            // if within min ticket of max cap then move state
            if (_totalTokensInt + MIN_TICKET_TOKENS >= MAX_NUMBER_OF_TOKENS) {
                // todo: must write tests wl -> public and public -> signing. first one is potential problem, should we skip public in that case?
                return oldState == ETOState.Whitelist ? ETOState.Public : ETOState.Signing;
            }
        }
        if (oldState == ETOState.Signing && _nomineeSignedInvestmentAgreementUrlHash != bytes32(0)) {
            return ETOState.Claim;
        }
        /*if (oldState == ETOState.Claim) {
            // we can go to payout if all assets claimed!
            if (NEUMARK.balanceOf(this) == 0 && EQUITY_TOKEN.balanceOf(this) == 0 &&
                ETHER_TOKEN.balanceOf(this) == 0 && EURO_TOKEN.balanceOf(this) == 0) {
                transitionTo(ETOState.Payout);
            }
        }*/
        return oldState;
    }

    function mBeforeStateTransition(ETOState oldState, ETOState newState)
        internal
        constant
        returns (ETOState)
    {
        // force refund if floor criteria are not met
        if (newState == ETOState.Signing && _totalTokensInt < MIN_NUMBER_OF_TOKENS) {
            return ETOState.Refund;
        }
        // go to refund if attempt to go to Claim without nominee agreement confirmation
        if (newState == ETOState.Claim && _nomineeSignedInvestmentAgreementUrlHash == bytes32(0)) {
            return ETOState.Refund;
        }

        return newState;
    }

    function mAfterTransition(ETOState /*oldState*/, ETOState newState)
        internal
    {
        if (newState == ETOState.Signing) {
            onSigningTransition();
        }
        if (newState == ETOState.Claim) {
            onClaimTransition();
        }
        if (newState == ETOState.Refund) {
            onRefundTransition();
        }
        if (newState == ETOState.Payout) {
            onPayoutTransition();
        }
    }

    //
    // Overrides Agreement internal interface
    //

    function mCanAmend(address legalRepresentative)
        internal
        returns (bool)
    {
        return legalRepresentative == NOMINEE;
    }

    ////////////////////////
    // Private functions
    ////////////////////////

    // a copy of ETOPlatformTerms working on local storage
    function calculateNeumarkDistribution(uint256 rewardNmk)
        private
        constant
        returns (uint256 platformNmk, uint256 investorNmk)
    {
        // round down - platform may get 1 wei less than investor
        platformNmk = rewardNmk / PLATFORM_NEUMARK_SHARE;
        // rewardNmk > platformNmk always
        return (platformNmk, rewardNmk - platformNmk);
    }

    /// called on transition to Signing
    function onSigningTransition()
        private
    {
        // get final balances
        uint256 etherBalance = ETHER_TOKEN.balanceOf(this);
        uint256 euroBalance = EURO_TOKEN.balanceOf(this);
        // additional equity tokens are issued and sent to platform operator (temporarily)
        uint256 tokensPerShare = EQUITY_TOKEN.tokensPerShare();
        uint256 tokenParticipationFeeInt = PLATFORM_TERMS.calculatePlatformTokenFee(_totalTokensInt);
        // we must have integer number of shares
        uint256 tokensRemainder = (_totalTokensInt + tokenParticipationFeeInt) % tokensPerShare;
        if (tokensRemainder > 0) {
            // round up to whole share
            tokenParticipationFeeInt += tokensPerShare - tokensRemainder;
        }
        // assert 96bit values 2**96 / 10**18 ~ 78 bln
        assert(_totalTokensInt + tokenParticipationFeeInt < 2 ** 96);
        assert(etherBalance < 2 ** 96 && euroBalance < 2 ** 96);
        // we save 30k gas on 96 bit resolution, we can live with 98 bln euro max investment amount
        _newShares = uint96((_totalTokensInt + tokenParticipationFeeInt) / tokensPerShare);
        // preserve platform token participation fee to be send out on claim transition
        _tokenParticipationFeeInt = uint96(tokenParticipationFeeInt);
        // compute fees to be sent on payout transition
        _platformFeeEth = uint96(PLATFORM_TERMS.calculatePlatformFee(etherBalance));
        _platformFeeEurUlps = uint96(PLATFORM_TERMS.calculatePlatformFee(euroBalance));
        // compute additional contributions to be sent on claim transition
        _additionalContributionEth = uint96(etherBalance) - _platformFeeEth;
        _additionalContributionEurUlps = uint96(euroBalance) - _platformFeeEurUlps;
        // issue missing tokens
        EQUITY_TOKEN.issueTokens(tokenParticipationFeeInt);
        // nominee gets nominal share value immediately to be added to cap table
        uint256 capitalIncreaseEurUlps = EQUITY_TOKEN.shareNominalValueEurUlps() * _newShares;
        // limit the amount if balance on EURO_TOKEN < capitalIncreaseEurUlps. in that case Nomine must handle it offchain
        uint96 availableCapitalEurUlps = uint96(min(capitalIncreaseEurUlps, _additionalContributionEurUlps)); // no overflow as smaller one is uint96
        assert(EURO_TOKEN.transfer(NOMINEE, availableCapitalEurUlps, ""));
        // decrease additional contribution by value that was sent to nominee
        _additionalContributionEurUlps -= availableCapitalEurUlps;

        emit LogSigningStarted(NOMINEE, COMPANY_LEGAL_REPRESENTATIVE, _newShares, capitalIncreaseEurUlps);
    }

    /// called on transition to ETOState.Claim
    function onClaimTransition()
        private
    {
        // platform operator gets share of NEU
        uint256 rewardNmk = NEUMARK.balanceOf(this);
        (uint256 platformNmk,) = calculateNeumarkDistribution(rewardNmk);
        assert(NEUMARK.transfer(PLATFORM_WALLET, platformNmk, ""));
        // company legal rep receives funds
        if (_additionalContributionEth > 0) {
            assert(ETHER_TOKEN.transfer(COMPANY_LEGAL_REPRESENTATIVE, _additionalContributionEth, ""));
        }

        if (_additionalContributionEurUlps > 0) {
            assert(EURO_TOKEN.transfer(COMPANY_LEGAL_REPRESENTATIVE, _additionalContributionEurUlps, ""));
        }
        emit LogPlatformNeuReward(rewardNmk, platformNmk);
        emit LogAdditionalContribution(COMPANY_LEGAL_REPRESENTATIVE, ETHER_TOKEN, _additionalContributionEth);
        emit LogAdditionalContribution(COMPANY_LEGAL_REPRESENTATIVE, EURO_TOKEN, _additionalContributionEurUlps);
    }

    /// called on transtion to ETOState.Refund
    function onRefundTransition()
        private
    {
        // burn all neumark generated in this ETO
        uint256 balanceNmk = NEUMARK.balanceOf(this);
        uint256 balanceTokenInt = EQUITY_TOKEN.balanceOf(this);
        if (balanceNmk > 0) {
            NEUMARK.burn(balanceNmk);
        }
        // destroy all tokens generated in ETO
        if (balanceTokenInt > 0) {
            EQUITY_TOKEN.destroyTokens(balanceTokenInt);
        }
        emit LogRefundStarted(EQUITY_TOKEN, balanceTokenInt, balanceNmk);
    }

    /// called on transition to ETOState.Payout
    function onPayoutTransition()
        private
    {
        // distribute what's left in balances: company took funds on claim
        address disbursal = UNIVERSE.feeDisbursal();
        assert(disbursal != address(0));
        if (_platformFeeEth > 0) {
            // disburse via ERC223, where we encode token used to provide pro-rata in `data` parameter
            assert(ETHER_TOKEN.transfer(disbursal, _platformFeeEth, addressToBytes(NEUMARK)));
        }
        if (_platformFeeEurUlps > 0) {
            // disburse via ERC223
            assert(EURO_TOKEN.transfer(disbursal, _platformFeeEurUlps, addressToBytes(NEUMARK)));
        }
        // add token participation fee to platfrom portfolio
        EQUITY_TOKEN.distributeTokens(PLATFORM_WALLET, _tokenParticipationFeeInt);

        emit LogPlatformFeePayout(ETHER_TOKEN, disbursal, _platformFeeEth);
        emit LogPlatformFeePayout(EURO_TOKEN, disbursal, _platformFeeEurUlps);
        emit LogPlatformPortfolioPayout(EQUITY_TOKEN, PLATFORM_WALLET, _tokenParticipationFeeInt);
    }

    function processTicket(
        address investor,
        uint256 amount,
        bool isLockedAccount
    )
        private
        returns (uint96 equityTokenInt, uint96 rewardNmkUlps, uint96 equivEurUlps)
    {
        require(amount < 2**96);
        bool isEuroInvestment = msg.sender == address(EURO_TOKEN);
        // compute EUR eurEquivalent via oracle if ether
        if (!isEuroInvestment) {
            (uint256 rate, uint256 rateTimestamp) = CURRENCY_RATES.getExchangeRate(ETHER_TOKEN, EURO_TOKEN);
            // require if rate older than 4 hours
            require(block.timestamp - rateTimestamp < 4 hours);
            equivEurUlps = uint96(decimalFraction(amount, rate));
        } else {
            equivEurUlps = uint96(amount);
        }
        // kick on minimum ticket
        require(equivEurUlps >= MIN_TICKET_EUR_ULPS);
        // read current ticket
        InvestmentTicket storage ticket = _tickets[investor];
        // kick on max ticket exceeded
        require(ticket.equivEurUlps + equivEurUlps <= MAX_TICKET_EUR_ULPS);
        // we trust NEU token so we issue NEU before writing state
        // issue only for "new money" so LockedAccount from ICBM is excluded
        if (!isLockedAccount) {
            (, uint256 investorNmk) = calculateNeumarkDistribution(NEUMARK.issueForEuro(equivEurUlps));
            if (investorNmk > 0) {
                // now there is rounding danger as we calculate the above for any investor but then just once to get platform share in onClaimTransition
                // it is much cheaper to just round down than to book keep to a single wei which will use additional storage
                // small amount of NEU ( no of investors * (PLATFORM_NEUMARK_SHARE-1)) may be left in contract
                investorNmk -= PLATFORM_NEUMARK_SHARE - 1;
                // uint96 is much more than 1.5 bln of NEU so no overflow
                rewardNmkUlps = uint96(investorNmk);
            }
        }
        // issue ET
        uint256 equityTokenInt256 = ETO_TERMS.calculateTokenAmount(_totalEquivEurUlps, equivEurUlps);
        // kick on cap exceeded
        require(_totalTokensInt + equityTokenInt256 > MAX_NUMBER_OF_TOKENS);
        assert(equityTokenInt256 < 2 ** 96);
        equityTokenInt = uint96(equityTokenInt256);
        // write new values
        ticket.equivEurUlps += equivEurUlps;
        ticket.rewardNmkUlps += rewardNmkUlps;
        ticket.equityTokenInt += equityTokenInt;
        if (isEuroInvestment) {
            ticket.equivEurUlps += uint96(amount);
        } else {
            ticket.amountEth += uint96(amount);
        }
        ticket.usedLockedAccount = ticket.usedLockedAccount || isLockedAccount;

        EQUITY_TOKEN.issueTokens(equityTokenInt);

        return (equityTokenInt, rewardNmkUlps, equivEurUlps);
    }

    function claimTokensPrivate(address investor)
        private
    {
        InvestmentTicket storage ticket = _tickets[investor];
        if (ticket.claimOrRefundSettled) {
            return;
        }
        ticket.claimOrRefundSettled = true;

        if (ticket.rewardNmkUlps > 0) {
            NEUMARK.distribute(investor, ticket.rewardNmkUlps);
        }
        if (ticket.equityTokenInt > 0) {
            EQUITY_TOKEN.distributeTokens(investor, ticket.equityTokenInt);
        }
        if (ticket.usedLockedAccount) {
            ETHER_LOCK.claimed(investor);
            EURO_LOCK.claimed(investor);
        }
        emit LogTokensClaimed(investor, EQUITY_TOKEN, ticket.equityTokenInt, ticket.rewardNmkUlps);
    }

    function refundTokensPrivate(address investor)
        private
    {
        InvestmentTicket storage ticket = _tickets[investor];
        if (ticket.claimOrRefundSettled) {
            return;
        }
        ticket.claimOrRefundSettled = true;
        refundSingleToken(investor, ticket.amountEth, ticket.usedLockedAccount, ETHER_LOCK, ETHER_TOKEN);
        refundSingleToken(investor, ticket.amountEurUlps, ticket.usedLockedAccount, EURO_LOCK, EURO_TOKEN);

        emit LogFundsRefunded(investor, ETHER_TOKEN, ticket.amountEth);
        emit LogFundsRefunded(investor, EURO_TOKEN, ticket.amountEurUlps);
    }

    function refundSingleToken(
        address investor,
        uint256 amount,
        bool usedLockedAccount,
        LockedAccount lockedAccount,
        IERC223Token token
    )
        private
    {
        if (amount == 0) {
            return;
        }
        uint256 a = amount;
        // possible partial refund to locked account
        if (usedLockedAccount) {
            (uint256 balance,) = lockedAccount.investment(this, investor);
            assert(balance <= a);
            if (balance > 0) {
                assert(token.approve(address(lockedAccount), balance));
                lockedAccount.refunded(investor);
                a -= balance;
            }
        }
        if (a > 0) {
            assert(token.transfer(investor, a, ""));
        }
    }
}
