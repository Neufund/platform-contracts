pragma solidity 0.4.25;

import "./ETOTimedStateMachine.sol";
import "./ETOTerms.sol";
import "../Universe.sol";
import "../Company/IEquityToken.sol";
import "../ICBM/LockedAccount.sol";
import "../AccessControl/AccessControlled.sol";
import "../Agreement.sol";
import "../Math.sol";
import "../Serialization.sol";


/// @title represents token offering organized by Company
///  token offering goes through states as defined in ETOTimedStateMachine
///  setup phase requires several parties to provide documents and information
///   (deployment (by anyone) -> eto terms (company) -> RAAA agreement (nominee) -> adding to universe (platform) + issue NEU -> start date (company))
///   price curves, whitelists, discounts and other offer terms are extracted to ETOTerms
/// todo: review all divisions for rounding errors
contract ETOCommitment is
    AccessControlled,
    Agreement,
    ETOTimedStateMachine,
    Math,
    Serialization,
    IContractId
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
    // currency rate oracle
    ITokenExchangeRateOracle private CURRENCY_RATES;

    // max cap taken from ETOTerms for low gas costs
    uint256 private MIN_NUMBER_OF_TOKENS;
    // min cap taken from ETOTerms for low gas costs
    uint256 private MAX_NUMBER_OF_TOKENS;
    // max cap of tokens in whitelist (without fixed slots)
    uint256 private MAX_NUMBER_OF_TOKENS_IN_WHITELIST;
    // minimum ticket in tokens with base price
    uint256 private MIN_TICKET_TOKENS;
    // platform operator share for low gas costs
    uint128 private PLATFORM_NEUMARK_SHARE;
    // token rate expires after
    uint128 private TOKEN_RATE_EXPIRES_AFTER;

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
    PlatformTerms private PLATFORM_TERMS;

    ////////////////////////
    // Mutable state
    ////////////////////////

    // investment tickets
    mapping (address => InvestmentTicket) private _tickets;

    // data below start at 32 bytes boundary and pack into 32 bytes word
    // total investment in euro equivalent (ETH converted on spot prices)
    uint112 private _totalEquivEurUlps;

    // total equity tokens acquired
    uint56 private _totalTokensInt;

    // total equity tokens acquired in fixed slots
    uint56 private _totalFixedSlotsTokensInt;

    // total investors that participated
    uint32 private _totalInvestors;

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

    // signed investment agreement url
    string private _signedInvestmentAgreementUrl;

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

    modifier onlyWithAgreement {
        require(amendmentsCount() > 0);
        _;
    }

    ////////////////////////
    // Events
    ////////////////////////

    // logged on claim state transition indicating that additional contribution was released to company
    event LogAdditionalContribution(
        address companyLegalRep,
        address paymentToken,
        uint256 amount
    );

    // logged on claim state transition indicating NEU reward available
    event LogPlatformNeuReward(
        address platformWallet,
        uint256 totalRewardNmkUlps,
        uint256 platformRewardNmkUlps
    );

    // logged on payout transition to mark cash payout to NEU holders
    event LogPlatformFeePayout(
        address paymentToken,
        address disbursalPool,
        uint256 amount
    );

    // logged on payout transition to mark equity token payout to portfolio smart contract
    event LogPlatformPortfolioPayout(
        address assetToken,
        address platformPortfolio,
        uint256 amount
    );

    ////////////////////////
    // Constructor
    ////////////////////////

    /// anyone may be a deployer, the platform acknowledges the contract by adding it to Universe Commitment collection
    constructor(
        Universe universe,
        address platformWallet,
        address nominee,
        address companyLegalRep,
        ETOTerms etoTerms,
        IEquityToken equityToken
    )
        Agreement(universe.accessPolicy(), universe.forkArbiter())
        ETOTimedStateMachine()
        public
    {
        UNIVERSE = universe;
        PLATFORM_TERMS = PlatformTerms(universe.platformTerms());

        require(equityToken.decimals() == etoTerms.TOKEN_TERMS().EQUITY_TOKENS_PRECISION());
        require(platformWallet != address(0) && nominee != address(0) && companyLegalRep != address(0));
        require(etoTerms.requireValidTerms(PLATFORM_TERMS));

        PLATFORM_WALLET = platformWallet;
        COMPANY_LEGAL_REPRESENTATIVE = companyLegalRep;
        NOMINEE = nominee;
        PLATFORM_NEUMARK_SHARE = uint128(PLATFORM_TERMS.PLATFORM_NEUMARK_SHARE());
        TOKEN_RATE_EXPIRES_AFTER = uint128(PLATFORM_TERMS.TOKEN_RATE_EXPIRES_AFTER());

        NEUMARK = universe.neumark();
        ETHER_TOKEN = universe.etherToken();
        EURO_TOKEN = universe.euroToken();
        ETHER_LOCK = LockedAccount(universe.etherLock());
        EURO_LOCK = LockedAccount(universe.euroLock());
        CURRENCY_RATES = ITokenExchangeRateOracle(universe.tokenExchangeRateOracle());

        ETO_TERMS = etoTerms;
        EQUITY_TOKEN = equityToken;

        MAX_NUMBER_OF_TOKENS = etoTerms.TOKEN_TERMS().MAX_NUMBER_OF_TOKENS();
        MAX_NUMBER_OF_TOKENS_IN_WHITELIST = etoTerms.TOKEN_TERMS().MAX_NUMBER_OF_TOKENS_IN_WHITELIST();
        MIN_NUMBER_OF_TOKENS = etoTerms.TOKEN_TERMS().MIN_NUMBER_OF_TOKENS();
        MIN_TICKET_TOKENS = etoTerms.calculateTokenAmount(0, etoTerms.MIN_TICKET_EUR_ULPS());

        setupStateMachine(
            ETO_TERMS.DURATION_TERMS(),
            IETOCommitmentObserver(EQUITY_TOKEN.tokenController())
        );
    }

    ////////////////////////
    // External functions
    ////////////////////////

    /// @dev sets timed state machine in motion
    function setStartDate(
        ETOTerms etoTerms,
        IEquityToken equityToken,
        uint256 startDate
    )
        external
        onlyCompany
        onlyWithAgreement
        withStateTransition()
        onlyState(ETOState.Setup)
    {
        require(etoTerms == ETO_TERMS);
        require(equityToken == EQUITY_TOKEN);
        assert(startDate < 0xFFFFFFFF);
        // must be more than NNN days (platform terms!)
        require(
            startDate > block.timestamp && startDate - block.timestamp > PLATFORM_TERMS.DATE_TO_WHITELIST_MIN_DURATION(),
            "NF_ETO_DATE_TOO_EARLY");
        // prevent re-setting start date if ETO starts too soon
        uint256 startAt = startOfInternal(ETOState.Whitelist);
        // block.timestamp must be less than startAt, otherwise timed state transition is done
        require(
            startAt == 0 || (startAt - block.timestamp > PLATFORM_TERMS.DATE_TO_WHITELIST_MIN_DURATION()),
            "NF_ETO_START_TOO_SOON");
        runStateMachine(uint32(startDate));
        // todo: lock ETO_TERMS whitelist to be more trustless

        emit LogTermsSet(msg.sender, address(etoTerms), address(equityToken));
        emit LogETOStartDateSet(msg.sender, startAt, startDate);
    }

    function companySignsInvestmentAgreement(string signedInvestmentAgreementUrl)
        public
        withStateTransition()
        onlyState(ETOState.Signing)
        onlyCompany
    {
        _signedInvestmentAgreementUrl = signedInvestmentAgreementUrl;
        emit LogCompanySignedAgreement(msg.sender, NOMINEE, signedInvestmentAgreementUrl);
    }

    function nomineeConfirmsInvestmentAgreement(string signedInvestmentAgreementUrl)
        public
        withStateTransition()
        onlyState(ETOState.Signing)
        onlyNominee
    {
        bytes32 nomineeHash = keccak256(abi.encodePacked(signedInvestmentAgreementUrl));
        require(keccak256(abi.encodePacked(_signedInvestmentAgreementUrl)) == nomineeHash, "NF_INV_HASH");
        // setting this variable will induce state transition to Claim via mAdavanceLogicState
        _nomineeSignedInvestmentAgreementUrlHash = nomineeHash;
        emit LogNomineeConfirmedAgreement(msg.sender, COMPANY_LEGAL_REPRESENTATIVE, signedInvestmentAgreementUrl);
    }

    //
    // Implements ICommitment
    //

    /// commit function happens via ERC223 callback that must happen from trusted payment token
    /// @dev data in case of LockedAccount contains investor address and investor is LockedAccount address
    function tokenFallback(address wallet, uint256 amount, bytes data)
        public
        withStateTransition()
        onlyStates(ETOState.Whitelist, ETOState.Public)
    {
        uint256 equivEurUlps = amount;
        bool isEuroInvestment = msg.sender == address(EURO_TOKEN);
        bool isEtherInvestment = msg.sender == address(ETHER_TOKEN);
        // we trust only tokens below
        require(isEtherInvestment || isEuroInvestment, "NF_ETO_UNK_TOKEN");
        // check if LockedAccount
        bool isLockedAccount = (wallet == address(ETHER_LOCK) || wallet == address(EURO_LOCK));
        address investor = wallet;
        if (isLockedAccount) {
            // data contains investor address
            investor = decodeAddress(data);
        }
        if (isEtherInvestment) {
            // compute EUR eurEquivalent via oracle if ether
            (uint256 rate, uint256 rateTimestamp) = CURRENCY_RATES.getExchangeRate(ETHER_TOKEN, EURO_TOKEN);
            // require if rate older than 4 hours
            require(block.timestamp - rateTimestamp < TOKEN_RATE_EXPIRES_AFTER, "NF_ETO_INVALID_ETH_RATE");
            equivEurUlps = decimalFraction(amount, rate);
        }
        // agreement accepted by act of reserving funds in this function
        acceptAgreementInternal(investor);
        // we modify state and emit events in function below
        processTicket(investor, wallet, amount, equivEurUlps, isEuroInvestment);
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
        for(uint256 ii = 0; ii < investors.length; ii++) {
            claimTokensPrivate(investors[ii]);
        }
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
        for(uint256 ii = 0; ii < investors.length; ii++) {
            refundTokensPrivate(investors[ii]);
        }
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

    //
    // IETOCommitment getters
    //

    function signedInvestmentAgreementUrl()
        public
        constant
        returns (string)
    {
        return _signedInvestmentAgreementUrl;
    }

    function contributionSummary()
        public
        constant
        returns (
            uint256 newShares, uint256 capitalIncreaseEurUlps,
            uint256 additionalContributionEth, uint256 additionalContributionEurUlps,
            uint256 tokenParticipationFeeInt, uint256 platformFeeEth, uint256 platformFeeEurUlps,
            uint256 sharePriceEurUlps
        )
    {
        return (
            _newShares, _newShares * EQUITY_TOKEN.shareNominalValueEurUlps(),
            _additionalContributionEth, _additionalContributionEurUlps,
            _tokenParticipationFeeInt, _platformFeeEth, _platformFeeEurUlps,
            _newShares == 0 ? 0 : divRound(_totalEquivEurUlps, _newShares)
        );
    }

    function etoTerms() public constant returns (ETOTerms) {
        return ETO_TERMS;
    }

    function equityToken() public constant returns (IEquityToken) {
        return EQUITY_TOKEN;
    }

    function nominee() public constant returns (address) {
        return NOMINEE;
    }

    function companyLegalRep() public constant returns (address) {
        return COMPANY_LEGAL_REPRESENTATIVE;
    }

    function singletons()
        public
        constant
        returns (
            address platformWallet,
            address universe,
            address platformTerms
            )
    {
        platformWallet = PLATFORM_WALLET;
        universe = UNIVERSE;
        platformTerms = PLATFORM_TERMS;
    }

    function totalInvestment()
        public
        constant
        returns (
            uint256 totalEquivEurUlps,
            uint256 totalTokensInt,
            uint256 totalInvestors
            )
    {
        return (_totalEquivEurUlps, _totalTokensInt, _totalInvestors);
    }

    function calculateContribution(address investor, bool fromIcbmWallet, uint256 newInvestorContributionEurUlps)
        external
        constant
        // use timed state so we show what should be
        withStateTransition()
        returns (
            bool isWhitelisted,
            bool isEligible,
            uint256 minTicketEurUlps,
            uint256 maxTicketEurUlps,
            uint256 equityTokenInt,
            uint256 neuRewardUlps,
            bool maxCapExceeded
            )
    {
        InvestmentTicket storage ticket = _tickets[investor];
        // we use state() here because time was forwarded by withStateTransition
        bool applyDiscounts = state() == ETOState.Whitelist;
        uint256 fixedSlotsEquityTokenInt;
        (
            isWhitelisted,
            isEligible,
            minTicketEurUlps,
            maxTicketEurUlps,
            equityTokenInt,
            fixedSlotsEquityTokenInt
        ) = ETO_TERMS.calculateContribution(
            investor,
            _totalEquivEurUlps,
            ticket.equivEurUlps,
            newInvestorContributionEurUlps,
            applyDiscounts
        );
        isWhitelisted = isWhitelisted || fromIcbmWallet;
        if (!fromIcbmWallet) {
            (,neuRewardUlps) = calculateNeumarkDistribution(NEUMARK.incremental(newInvestorContributionEurUlps));
        }
        // crossing max cap can always happen
        maxCapExceeded = isCapExceeded(applyDiscounts, equityTokenInt, fixedSlotsEquityTokenInt);
    }

    function investorTicket(address investor)
        public
        constant
        returns (
            uint256 equivEurUlps,
            uint256 rewardNmkUlps,
            uint256 equityTokenInt,
            uint256 sharesInt,
            uint256 tokenPrice,
            uint256 neuRate,
            uint256 amountEth,
            uint256 amountEurUlps,
            bool claimedOrRefunded,
            bool usedLockedAccount
        )
    {
        InvestmentTicket storage ticket = _tickets[investor];
        // here we assume that equity token precisions is 0
        equivEurUlps = ticket.equivEurUlps;
        rewardNmkUlps = ticket.rewardNmkUlps;
        equityTokenInt = ticket.equityTokenInt;
        sharesInt = ETO_TERMS.equityTokensToShares(ticket.equityTokenInt);
        tokenPrice = equityTokenInt > 0 ? equivEurUlps / equityTokenInt : 0;
        neuRate = rewardNmkUlps > 0 ? proportion(equivEurUlps, 10**18, rewardNmkUlps) : 0;
        amountEth = ticket.amountEth;
        amountEurUlps = ticket.amountEurUlps;
        claimedOrRefunded = ticket.claimOrRefundSettled;
        usedLockedAccount = ticket.usedLockedAccount;
    }

    //
    // Implements IContractId
    //

    function contractId() public pure returns (bytes32 id, uint256 version) {
        return (0x70ef68fc8c585f9edc7af1bfac26c4b1b9e98ba05cf5ddd99e4b3dc46ea70073, 0);
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
        // add 1 to MIN_TICKET_TOKEN because it was produced by floor and check only MAX CAP
        // WHITELIST CAP will not induce state transition as fixed slots should be able to invest till the end of Whitelist
        bool capExceeded = isCapExceeded(false, MIN_TICKET_TOKENS + 1, 0);
        if (capExceeded) {
            if (oldState == ETOState.Whitelist) {
                return ETOState.Public;
            }
            if (oldState == ETOState.Public) {
                return ETOState.Signing;
            }
        }
        if (oldState == ETOState.Signing && _nomineeSignedInvestmentAgreementUrlHash != bytes32(0)) {
            return ETOState.Claim;
        }
        return oldState;
    }

    function mBeforeStateTransition(ETOState /*oldState*/, ETOState newState)
        internal
        constant
        returns (ETOState)
    {
        // force refund if floor criteria are not met
        // todo: allow for super edge case when MIN_NUMBER_OF_TOKENS is very close to MAX_NUMBER_OF_TOKENS and we are within minimum ticket
        if (newState == ETOState.Signing && _totalTokensInt < MIN_NUMBER_OF_TOKENS) {
            return ETOState.Refund;
        }
        // go to refund if attempt to go to Claim without nominee agreement confirmation
        // if (newState == ETOState.Claim && _nomineeSignedInvestmentAgreementUrlHash == bytes32(0)) {
        //     return ETOState.Refund;
        // }

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
        return legalRepresentative == NOMINEE && startOfInternal(ETOState.Whitelist) == 0;
    }

    ////////////////////////
    // Private functions
    ////////////////////////

    // a copy of PlatformTerms working on local storage
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
        // nominee gets nominal share value immediately to be added to cap table
        uint256 capitalIncreaseEurUlps = EQUITY_TOKEN.shareNominalValueEurUlps() * _newShares;
        // limit the amount if balance on EURO_TOKEN < capitalIncreaseEurUlps. in that case Nomine must handle it offchain
        // no overflow as smaller one is uint96
        uint96 availableCapitalEurUlps = uint96(min(capitalIncreaseEurUlps, _additionalContributionEurUlps));
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
        // issue missing tokens
        EQUITY_TOKEN.issueTokens(_tokenParticipationFeeInt);
        emit LogPlatformNeuReward(PLATFORM_WALLET, rewardNmk, platformNmk);
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
        address platformPortfolio = UNIVERSE.platformPortfolio();
        assert(platformPortfolio != address(0));
        bytes memory serializedAddress = abi.encodePacked(address(NEUMARK));
        // assert(decodeAddress(serializedAddress) == address(NEUMARK));
        if (_platformFeeEth > 0) {
            // disburse via ERC223, where we encode token used to provide pro-rata in `data` parameter
            assert(ETHER_TOKEN.transfer(disbursal, _platformFeeEth, serializedAddress));
        }
        if (_platformFeeEurUlps > 0) {
            // disburse via ERC223
            assert(EURO_TOKEN.transfer(disbursal, _platformFeeEurUlps, serializedAddress));
        }
        // add token participation fee to platfrom portfolio
        EQUITY_TOKEN.distributeTokens(platformPortfolio, _tokenParticipationFeeInt);

        emit LogPlatformFeePayout(ETHER_TOKEN, disbursal, _platformFeeEth);
        emit LogPlatformFeePayout(EURO_TOKEN, disbursal, _platformFeeEurUlps);
        emit LogPlatformPortfolioPayout(EQUITY_TOKEN, platformPortfolio, _tokenParticipationFeeInt);
    }

    function processTicket(
        address investor,
        address wallet,
        uint256 amount,
        uint256 equivEurUlps,
        bool isEuroInvestment
    )
        private
    {
        // read current ticket
        InvestmentTicket storage ticket = _tickets[investor];
        // should we apply whitelist discounts
        bool applyDiscounts = state() == ETOState.Whitelist;
        // calculate contribution
        (
            bool isWhitelisted,
            bool isEligible,
            uint minTicketEurUlps,
            uint256 maxTicketEurUlps,
            uint256 equityTokenInt256,
            uint256 fixedSlotEquityTokenInt256
        ) = ETO_TERMS.calculateContribution(investor, _totalEquivEurUlps, ticket.equivEurUlps, equivEurUlps, applyDiscounts);
        // kick out on KYC
        require(isEligible, "NF_ETO_INV_NOT_VER");
        assert(equityTokenInt256 < 2 ** 32 && fixedSlotEquityTokenInt256 < 2 ** 32);
        // kick on minimum ticket and you must buy at least one token!
        require(equivEurUlps + ticket.equivEurUlps >= minTicketEurUlps && equityTokenInt256 > 0, "NF_ETO_MIN_TICKET");
        // kick on max ticket exceeded
        require(equivEurUlps + ticket.equivEurUlps <= maxTicketEurUlps, "NF_ETO_MAX_TICKET");
        // kick on cap exceeded
        require(!isCapExceeded(applyDiscounts, equityTokenInt256, fixedSlotEquityTokenInt256), "NF_ETO_MAX_TOK_CAP");
        // when that sent money is not the same as investor it must be icbm locked wallet
        // bool isLockedAccount = wallet != investor;
        // kick out not whitelist or not LockedAccount
        if (applyDiscounts) {
            require(isWhitelisted || wallet != investor, "NF_ETO_NOT_ON_WL");
        }
        // we trust NEU token so we issue NEU before writing state
        // issue only for "new money" so LockedAccount from ICBM is excluded
        if (wallet == investor) {
            (, uint256 investorNmk) = calculateNeumarkDistribution(NEUMARK.issueForEuro(equivEurUlps));
            if (investorNmk > 0) {
                // now there is rounding danger as we calculate the above for any investor but then just once to get platform share in onClaimTransition
                // it is much cheaper to just round down than to book keep to a single wei which will use additional storage
                // small amount of NEU ( no of investors * (PLATFORM_NEUMARK_SHARE-1)) may be left in contract
                assert(investorNmk > PLATFORM_NEUMARK_SHARE - 1);
                investorNmk -= PLATFORM_NEUMARK_SHARE - 1;
            }
        }
        // issue equity token
        assert(equityTokenInt256 + ticket.equityTokenInt < 2**32);
        // this will also check ticket.amountEurUlps + uint96(amount) as ticket.equivEurUlps is always >= ticket.amountEurUlps
        assert(equivEurUlps + ticket.equivEurUlps < 2**96);
        assert(amount < 2**96);
        // practically impossible: would require price of ETH smaller than 1 EUR and > 2**96 amount of ether
        assert(uint256(ticket.amountEth) + amount < 2**96);
        EQUITY_TOKEN.issueTokens(uint32(equityTokenInt256));
        // update total investment
        _totalEquivEurUlps += uint96(equivEurUlps);
        _totalTokensInt += uint32(equityTokenInt256);
        _totalFixedSlotsTokensInt += uint32(fixedSlotEquityTokenInt256);
        _totalInvestors += ticket.equivEurUlps == 0 ? 1 : 0;
        // write new ticket values
        ticket.equivEurUlps += uint96(equivEurUlps);
        // uint96 is much more than 1.5 bln of NEU so no overflow
        ticket.rewardNmkUlps += uint96(investorNmk);
        ticket.equityTokenInt += uint32(equityTokenInt256);
        if (isEuroInvestment) {
            ticket.amountEurUlps += uint96(amount);
        } else {
            ticket.amountEth += uint96(amount);
        }
        ticket.usedLockedAccount = ticket.usedLockedAccount || wallet != investor;
        // log successful commitment
        emit LogFundsCommitted(
            investor,
            wallet,
            msg.sender,
            amount,
            equivEurUlps,
            equityTokenInt256,
            EQUITY_TOKEN,
            investorNmk
        );
    }

    function isCapExceeded(bool applyDiscounts, uint256 equityTokenInt, uint256 fixedSlotsEquityTokenInt)
        private
        constant
        returns (bool maxCapExceeded)
    {
        maxCapExceeded = _totalTokensInt + equityTokenInt > MAX_NUMBER_OF_TOKENS;
        if (applyDiscounts && !maxCapExceeded) {
            maxCapExceeded = _totalTokensInt + equityTokenInt - _totalFixedSlotsTokensInt - fixedSlotsEquityTokenInt > MAX_NUMBER_OF_TOKENS_IN_WHITELIST;
        }
    }

    function claimTokensPrivate(address investor)
        private
    {
        InvestmentTicket storage ticket = _tickets[investor];
        if (ticket.claimOrRefundSettled) {
            return;
        }
        if (ticket.equivEurUlps == 0) {
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
        if (ticket.equivEurUlps == 0) {
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
            (uint256 balance,) = lockedAccount.pendingCommitments(this, investor);
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
