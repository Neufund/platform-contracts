pragma solidity 0.4.23;

import "./ETOTimedStateMachine.sol";
import "./ETOTerms.sol";
import "../Universe.sol";
import "../Company/IEquityTokenController.sol";
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
///   (deployment (by anyone) -> eto terms (company) -> RAAA agreement (nominee) -> prospectus (Company) -> adding to universe (platform) -> start date (company))
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
        // euro equivalent of both currencies. note the following
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

    bytes32 private constant EMPTY_STRING_HASH = keccak256("");

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
    uint256 private MAX_CAP_EUR_ULPS;
    // min cap taken from ETOTerms for low gas costs
    uint256 private MIN_CAP_EUR_ULPS;
    // maximum ticket from ETOTerms for low gas costs
    uint256 private MAX_TICKET_EUR_ULPS;
    // maximum ticket for simple investor from ETOTerms for low gas costs
    uint256 private MAX_TICKET_SIMPLE_EUR_ULPS;
    // minimum ticket from ETOTerms for low gas costs
    uint256 private MIN_TICKET_EUR_ULPS;
    // platform operator share for low gas costs
    uint256 private PLATFORM_NEUMARK_SHARE;

    // wallet that keeps Platform Operator share of neumarks
    //  and where token participation fee is temporarily stored
    address private PLATFORM_WALLET;
    // company representative address
    address private COMPANY_LEGAL_REPRESENTATIVE;
    // nominee address
    address private NOMINEE;
    // company management contract
    IEquityTokenController private COMPANY;

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
    uint256 private _totalEquivEurUlps;

    // signed investment agreement url
    string private _signedInvestmentAgreementUrl;

    // nominee investment agreement url confirmation hash
    bytes32 private _nomineeSignedInvestmentAgreementUrlHash;

    // prospectus url
    string private _prospectusUrl;

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

    modifier onlyWithProspectus {
        require(hasProspectus());
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

    // logged at the moment Company sets prospectus
    event LogProspectusSet(
        address companyLegalRep,
        string prospectusUrl
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
        address companyLegalRep
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
    function ETOCommitment(
        Universe universe,
        ETOPlatformTerms platformTerms,
        address platformWallet,
        address nominee,
        address companyLegalRep
    )
        AccessControlled(universe.accessPolicy())
        Agreement(universe.accessPolicy(), universe.forkArbiter())
        ETOTimedStateMachine()
        public
    {
        UNIVERSE = universe;
        PLATFORM_TERMS = platformTerms;
        PLATFORM_WALLET = platformWallet;
        COMPANY_LEGAL_REPRESENTATIVE = companyLegalRep;
        NOMINEE = nominee;
        PLATFORM_NEUMARK_SHARE = platformTerms.PLATFORM_NEUMARK_SHARE();

        NEUMARK = universe.neumark();
        ETHER_TOKEN = universe.etherToken();
        EURO_TOKEN = universe.euroToken();
        ETHER_LOCK = LockedAccount(universe.etherLock());
        EURO_LOCK = LockedAccount(universe.euroLock());
        IDENTITY_REGISTRY = IIdentityRegistry(universe.identityRegistry());
        CURRENCY_RATES = ITokenExchangeRateOracle(universe.tokenExchangeRateOracle());

        emit LogETOCommitmentDeployed(msg.sender, address(platformTerms), nominee, companyLegalRep);
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
        withStateTransition()
        onlyState(State.Setup)
    {
        // must be integer precision
        require(equityToken.decimals() == 0, "ETO_ET_DECIMALS");
        require(equityToken.tokensPerShare() == etoTerms.TOKENS_PER_SHARE(), "ETO_ET_TPS_NE");
        etoTerms.requireValidTerms(PLATFORM_TERMS);

        ETO_TERMS = etoTerms;
        EQUITY_TOKEN = equityToken;
        COMPANY = EQUITY_TOKEN.equityTokenController();

        MAX_CAP_EUR_ULPS = etoTerms.MAX_CAP_EUR_ULPS();
        MIN_CAP_EUR_ULPS = etoTerms.MIN_CAP_EUR_ULPS();
        MAX_TICKET_EUR_ULPS = etoTerms.MAX_TICKET_EUR_ULPS();
        MAX_TICKET_SIMPLE_EUR_ULPS = etoTerms.MAX_TICKET_SIMPLE_EUR_ULPS();
        MIN_TICKET_EUR_ULPS = etoTerms.MIN_TICKET_EUR_ULPS();

        setupDurations(ETO_TERMS.DURATION_TERMS());

        emit LogTermsSet(msg.sender, address(etoTerms), address(equityToken));
    }

    function addWhitelisted(address[] investors)
        external
        onlyCompany
        onlyWithTerms
        withStateTransition()
        onlyState(State.Setup)
    {
        // TODO: implemement
    }

    function removeWhitelisted(address[] investors)
        external
        onlyCompany
        onlyWithTerms
        withStateTransition()
        onlyState(State.Setup)
    {
        // TODO: implemement
    }

    /// @dev used by PLATFORM_LEGAL_REP to kill commitment process before it starts
    /// @dev selfdestruct is executed
    function abort()
        external
        only(ROLE_PLATFORM_OPERATOR_REPRESENTATIVE)
        withStateTransition()
        onlyState(State.Setup)
    {
        selfdestruct(msg.sender);
    }

    function setProspectus(string prospectusUrl)
        external
        onlyCompany
        onlyWithTerms
        withStateTransition()
        onlyState(State.Setup)
    {
        _prospectusUrl = prospectusUrl;
        emit LogProspectusSet(msg.sender, prospectusUrl);
    }

    /// @dev sets timed state machine in motion,
    function setStartDate(uint256 startDate)
        external
        onlyCompany
        onlyWithTerms
        onlyWithProspectus
        onlyWithAgreement
        withStateTransition()
        onlyState(State.Setup)
    {
        // todo: check if in universe
        assert(startDate < 0xFFFFFFFF);
        // must be less than 3 days (platform terms!)
        require(startDate < block.timestamp && block.timestamp - startDate < PLATFORM_TERMS.DATE_TO_WHITELIST_MIN_DURATION(), "ETO_DATE_TOO_EARLY");
        // prevent re-setting of old date within
        uint256 startAt = startOfInternal(State.Whitelist);
        require(startAt == 0 || block.timestamp - startAt > PLATFORM_TERMS.DATE_TO_WHITELIST_MIN_DURATION(), "ETO_DATE_TOO_LATE");
        runTimedStateMachine(uint32(startDate));
        emit LogETOStartDateSet(msg.sender, startAt, startDate);
    }

    function companySignsInvestmentAgreement(string signedInvestmentAgreementUrl)
        external
        withStateTransition()
        onlyState(State.Signing)
        onlyCompany
    {
        _signedInvestmentAgreementUrl = signedInvestmentAgreementUrl;
        emit LogCompanySignedAgreement(msg.sender, NOMINEE, signedInvestmentAgreementUrl);
    }

    function nomineeConfirmsInvestmentAgreement(string signedInvestmentAgreementUrl)
        external
        withStateTransition()
        onlyState(State.Signing)
        onlyNominee
    {
        bytes32 nomineeHash = keccak256(signedInvestmentAgreementUrl);
        require(keccak256(_signedInvestmentAgreementUrl) == nomineeHash, "INV_HASH");
        _nomineeSignedInvestmentAgreementUrlHash = nomineeHash;
        emit LogNomineeConfirmedAgreement(msg.sender, COMPANY_LEGAL_REPRESENTATIVE);
    }

    //
    // Implements ICommitment
    //

    /// commit function happens via ERC223 callback that must happen from trusted payment token
    /// @dev data in case of LockedAccount contains investor address and investor is LockedAccount address
    function tokenFallback(address investorOrProxy, uint256 amount, bytes data)
        public
        withStateTransition()
        onlyStates(State.Whitelist, State.Public)
    {
        // we trust only tokens below
        require(msg.sender == address(ETHER_TOKEN) || msg.sender == address(EURO_TOKEN));
        // check if LockedAccount
        bool isLockedAccount = (investorOrProxy == address(ETHER_LOCK) || investorOrProxy == address(EURO_LOCK));
        address investor = investorOrProxy;
        if (isLockedAccount) {
            // data contains investor address
            investor = addressFromBytes(data); // solium-disable-line security/no-assign-params
        }
        // agreement accepted by act of reserving funds in this function
        acceptAgreementInternal(investor);
        // kick out not whitelist or not LockedAccount
        if (state() == State.Whitelist) {
            require(_whitelist[investor] || isLockedAccount);
        }
        // kick out on KYC
        IdentityClaims memory claims = deserializeClaims(IDENTITY_REGISTRY.getClaims(investor));
        require(claims.hasKyc);
        // calculate maximum ticket
        uint256 maxTicketEurUlps = claims.isSophisticatedInvestor ? MAX_TICKET_EUR_ULPS : MAX_TICKET_SIMPLE_EUR_ULPS;
        // process ticket
        uint96 equityTokenInt;
        uint96 rewardNmkUlps;
        uint256 equivEurUlps;
        (equityTokenInt, rewardNmkUlps, equivEurUlps) = processTicket(investor, amount, maxTicketEurUlps, isLockedAccount);
        // update total investment
        _totalEquivEurUlps += equivEurUlps;
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
        onlyStates(State.Claim, State.Payout)

    {
        claimTokensPrivate(msg.sender);
    }

    function claimMany(address[] investors)
        external
        withStateTransition()
        onlyStates(State.Claim, State.Payout)
    {
        // todo: claim in a loop
    }

    function refund()
        external
        withStateTransition()
        onlyState(State.Refund)

    {
        refundTokensPrivate(msg.sender);
    }

    function refundMany(address[] investors)
        external
        withStateTransition()
        onlyState(State.Refund)
    {
        // todo: refund in a loop
    }

    function payout()
        external
        withStateTransition()
        onlyState(State.Payout)
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

    function prospectusUrl()
        public
        constant
        returns (string)
    {
        return _prospectusUrl;
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

    ////////////////////////
    // Internal functions
    ////////////////////////

    //
    // Overrides internal interface
    //

    function mAdavanceLogicState(State oldState)
        internal
        constant
        returns (State)
    {
        if (oldState == State.Whitelist || oldState == State.Public) {
            // if within min ticket of max cap then move state
            if (_totalEquivEurUlps + MIN_TICKET_EUR_ULPS >= MAX_CAP_EUR_ULPS) {
                return oldState == State.Whitelist ? State.Public : State.Signing;
            }
        }
        if (oldState == State.Signing && _nomineeSignedInvestmentAgreementUrlHash != bytes32(0)) {
            return State.Claim;
        }
        /*if (oldState == State.Claim) {
            // we can go to payout if all assets claimed!
            if (NEUMARK.balanceOf(this) == 0 && EQUITY_TOKEN.balanceOf(this) == 0 &&
                ETHER_TOKEN.balanceOf(this) == 0 && EURO_TOKEN.balanceOf(this) == 0) {
                transitionTo(State.Payout);
            }
        }*/
        return oldState;
    }

    function mBeforeStateTransition(State oldState, State newState)
        internal
        constant
        returns (State)
    {
        // force refund if floor criteria are not met
        if (newState == State.Signing && _totalEquivEurUlps < MIN_CAP_EUR_ULPS) {
            return State.Refund;
        }
        // todo: consider refund if nominal value is not raised in Euro
        // go to refund if attempt to go to Claim without nominee agreement confirmation
        if (newState == State.Claim && _nomineeSignedInvestmentAgreementUrlHash != bytes32(0)) {
            return State.Refund;
        }

        // this is impossible: stateMachine cannot be run without all necessary terms
        /* if (newState == State.Whitelist && !setupComplete()) {
            return State.Refund;
        }*/

        return newState;
    }

    function mAfterTransition(State /*oldState*/, State newState)
        internal
    {
        if (newState == State.Signing) {
            onSigningTransition();
        }
        if (newState == State.Claim) {
            onClaimTransition();
        }
        if (newState == State.Refund) {
            onRefundTransition();
        }
        if (newState == State.Payout) {
            onPayoutTransition();
        }
    }

    //
    // Overrides Agreement
    //

    function canAmend(address legalRepresentative)
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
        public
        constant
        returns (uint256 platformNmk, uint256 investorNmk)
    {
        // round down - platform may get 1 wei less than investor
        platformNmk = rewardNmk / PLATFORM_NEUMARK_SHARE;
        // rewardNmk > platformNmk always
        return (platformNmk, rewardNmk - platformNmk);
    }

    /// called on transition to Signong
    function onSigningTransition()
        private
    {
        // get final balances
        uint256 etherBalance = ETHER_TOKEN.balanceOf(this);
        uint256 euroBalance = EURO_TOKEN.balanceOf(this);
        // additional equity tokens are issued and sent to platform operator (temporarily)
        uint256 totalTokenAmountInt = EQUITY_TOKEN.balanceOf(this);
        uint256 tokensPerShare = EQUITY_TOKEN.tokensPerShare();
        uint256 tokenParticipationFeeInt = PLATFORM_TERMS.calculatePlatformTokenFee(totalTokenAmountInt);
        // we must have integer number of shares
        uint256 tokensRemainder = (totalTokenAmountInt + tokenParticipationFeeInt) % tokensPerShare;
        if (tokensRemainder > 0) {
            // round up to whole share
            tokenParticipationFeeInt += tokensPerShare - tokensRemainder;
        }
        // assert 96bit values 2**96 / 10**18 ~ 78 bln
        assert(totalTokenAmountInt + tokenParticipationFeeInt < 2 ** 96);
        assert(etherBalance < 2 ** 96 && euroBalance < 2 ** 96);
        // we save 30k gas on 96 bit resolution, we can live 98 bln euro max investment amount
        _newShares = uint96((totalTokenAmountInt + tokenParticipationFeeInt) / tokensPerShare);
        // preserve platform token participation fee to be send out on claim transition
        _tokenParticipationFeeInt = uint96(tokenParticipationFeeInt);
        // nominal share value
        uint256 capitalIncreaseEurUlps = EQUITY_TOKEN.shareNominalValueEurUlps() * _newShares;
        // compute fees to be sent on payout transition
        _platformFeeEth = uint96(PLATFORM_TERMS.calculatePlatformFee(etherBalance));
        _platformFeeEurUlps = uint96(PLATFORM_TERMS.calculatePlatformFee(euroBalance));
        // compute additional contributions to be sent on claim transition
        _additionalContributionEth = uint96(etherBalance) - _platformFeeEth;
        _additionalContributionEurUlps = uint96(euroBalance) - _platformFeeEurUlps;
        // issue missing tokens
        EQUITY_TOKEN.issueTokens(tokenParticipationFeeInt);
        // nominee gets nominal share value immediately to be added to cap table
        assert(EURO_TOKEN.transfer(NOMINEE, capitalIncreaseEurUlps, ""));
        emit LogSigningStarted(NOMINEE, COMPANY_LEGAL_REPRESENTATIVE, _newShares, capitalIncreaseEurUlps);
    }

    /// called on transition to State.Claim
    function onClaimTransition()
        private
    {
        // platform operator gets share of NEU
        uint256 rewardNmk = NEUMARK.balanceOf(this);
        var (platformNmk,) = calculateNeumarkDistribution(rewardNmk);
        assert(NEUMARK.transfer(PLATFORM_WALLET, platformNmk, ""));
        // company contract has new token, new eto and new SHA (transfers are enabled on equity token if requested -> company is a controller so in call below)
        COMPANY.approveTokenOffering();
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

    /// called on transtion to State.Refund
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
        // fail ETO in COMPANY
        COMPANY.failTokenOffering();
        emit LogRefundStarted(EQUITY_TOKEN, balanceTokenInt, balanceNmk);
    }

    /// called on transition to State.Payout
    function onPayoutTransition()
        private
    {
        // distribute what's left in balances: company took funds on claim
        address disbursal = UNIVERSE.feeDisbursal();
        assert(disbursal != address(0));
        if (_platformFeeEth > 0) {
            // disburse via ERC223
            assert(ETHER_TOKEN.transfer(disbursal, _platformFeeEth, ""));
        }
        if (_platformFeeEurUlps > 0) {
            // disburse via ERC223
            assert(EURO_TOKEN.transfer(disbursal, _platformFeeEurUlps, ""));
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
        uint256 maxTicketEurUlps,
        bool isLockedAccount
    )
        private
        returns (uint96 equityTokenInt, uint96 rewardNmkUlps, uint256 equivEurUlps)
    {
        bool isEuroInvestment = msg.sender == address(EURO_TOKEN);
        // compute EUR eurEquivalent via oracle if ether
        if (!isEuroInvestment) {
            var (rate, rateTimestamp) = CURRENCY_RATES.getExchangeRate(ETHER_TOKEN, EURO_TOKEN);
            // require if rate older than 4 hours
            require(block.timestamp - rateTimestamp < 6 hours);
            equivEurUlps = decimalFraction(amount, rate);
        } else {
            equivEurUlps = amount;
        }
        // kick on minimum ticket
        require(equivEurUlps < MIN_TICKET_EUR_ULPS);
        // kick on cap exceeded
        require(_totalEquivEurUlps + equivEurUlps > MAX_CAP_EUR_ULPS);
        // read current ticket
        InvestmentTicket storage ticket = _tickets[investor];
        // kick on max ticket exceeded
        require(ticket.equivEurUlps + equivEurUlps > maxTicketEurUlps);
        // we trust NEU token so we issue NEU before writing state
        // issue only for "new money" so LockedAccount from ICBM is excluded
        if (!isLockedAccount) {
            var (, investorNmk) = calculateNeumarkDistribution(NEUMARK.issueForEuro(equivEurUlps));
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
        assert(equityTokenInt256 < 2 ** 96);
        // equity token has 0 precision: decimals 0 that's why we divide two precision18 integers to get 0 precision integer
        equityTokenInt = uint96(equityTokenInt256);
        // write new values
        ticket.equivEurUlps += uint96(equivEurUlps);
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
            var (balance,) = lockedAccount.investment(this, investor);
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

    function hasProspectus() private returns (bool) {
        return keccak256(_prospectusUrl) == EMPTY_STRING_HASH;
    }
}
