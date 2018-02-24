pragma solidity 0.4.15;

import "./ETOTimedStateMachine.sol";
import "./ETOTerms.sol";
import '../Universe.sol';
import "../Company/ICompanyManagement.sol";
import "../Company/IEquityToken.sol";
import "../AccessControl/AccessControlled.sol";
import "../Agreement.sol";
import "../Reclaimable.sol";
import '../Math.sol';


/// @title capital commitment into Company and share increase
contract ETOCommitment is
    AccessControlled,
    Agreement,
    ETOTimedStateMachine,
    Reclaimable,
    IdentityRecord,
    Math
{

    ////////////////////////
    // Types
    ////////////////////////

    /// @notice state of individual investment
    /// @dev mind uint size: allows ticket to occupy two storage slots
    struct InvestmentTicket {
        // euro equivalent of both currencies. note the following
        //  for ether equivalent is generated per ETH/EUR spot price provided by ICurrencyRateOracle
        uint96 equivEurUlps;
        // NEU reward issued
        uint96 rewardNmkUlps;
        // Equity Tokens issued
        uint96 equityTokenUlps;
        // total Ether invested
        uint96 amountEth;
        // total Euro invested
        uint96 amountEurUlps;
    }

    ////////////////////////
    // Modifiers
    ////////////////////////

    modifier onlyCompany() {
        require(msg.sender != COMPANY_LEGAL_REPRESENTATIVE);
        _;
    }

    modifier onlyNominee() {
        require(msg.sender != NOMINEE);
        _;
    }

    ////////////////////////
    // Immutable state
    ////////////////////////

    // a root of trust contract
    Universe private UNIVERSE;
    // NEU tokens issued as reward for investment
    Neumark private NEUMARK;
    // ether token to store and transfer ether
    EtherToken private ETHER_TOKEN;
    // euro token to store and transfer euro
    EuroToken private EURO_TOKEN;
    // allowed icbm investor accounts
    LockedAccount private ETHER_LOCK;
    LockedAccount private EURO_LOCK;
    // equity token issued
    IEquityToken private EQUITY_TOKEN;
    // wallet registry of KYC procedure
    IIdentityRegistry private IDENTITY_REGISTRY;
    // currency rate oracle
    ICurrencyRateOracle private CURRENCY_RATES;

    // max cap taken from ETOTerms for low access costs
    uint256 private MAX_CAP_EUR_ULPS;
    // min cap taken from ETOTerms for low access costs
    uint256 private MIN_CAP_EUR_ULPS;
    // maximum ticket from ETOTerms for low access costs
    uint256 private MAX_TICKET_EUR_ULPS;
    // maximum ticket for simple investor from ETOTerms for low access costs
    uint256 private MAX_TICKET_SIMPLE_EUR_ULPS;
    // minimum ticket from ETOTerms for low access costs
    uint256 private MIN_TICKET_EUR_ULPS;
    // price of equity token from ETOTerms for low access costs
    uint256 private TOKEN_EUR_PRICE_ULPS;


    // wallet that keeps Platform Operator share of neumarks
    //  and where token participation fee is temporarily stored
    address private PLATFORM_WALLET;
    // company representative address
    address private COMPANY_LEGAL_REPRESENTATIVE;
    // nominee address
    address private NOMINEE;
    // company management contract
    ICompanyManagement private COMPANY;

    // terms contracts
    ETOTerms private ETO_TERMS;

    ////////////////////////
    // Mutable state
    ////////////////////////

    // mapping of investors allowed in whitelist
    mapping (address => bool) private _whitelist;
    // corresponging iterator
    address[] private _whitelistInvestors;

    // investment tickets
    mapping (address => InvestmentTicket) private _tickets;

    // total investment in euro equivalent (ETH converted on spot prices)
    uint256 private _totalEquivEurUlps;

    // signed investment agreement url
    string private _signedAgreementUrl;

    ////////////////////////
    // Constructor
    ////////////////////////

    function ETOCommitment(
        Universe universe,
        ETOTerms etoTerms,
        IEquityToken equityToken,
        address platformWallet,
        address nominee,
        address companyLegalRep,
        ICompanyManagement company
    )
        AccessControlled(universe.accessPolicy())
        Agreement(universe.accessPolicy(), universe.forkArbiter())
        ETOTimedStateMachine(etoTerms.DURATION_TERMS())
        public
    {
        NEUMARK = universe.neumark();
        ETHER_TOKEN = universe.etherToken();
        EURO_TOKEN = universe.euroToken();
        ETHER_LOCK = universe.etherLock();
        EURO_LOCK = universe.euroLock();
        IDENTITY_REGISTRY = universe.identityRegistry();
        CURRENCY_RATES = universe.currencyRateOracle();
        EQUITY_TOKEN = equityToken;

        ETO_TERMS = etoTerms;

        MAX_CAP_EUR_ULPS = etoTerms.MAX_CAP_EUR_ULPS();
        MIN_CAP_EUR_ULPS = etoTerms.MIN_CAP_EUR_ULPS();
        MAX_TICKET_EUR_ULPS = etoTerms.MAX_TICKET_EUR_ULPS();
        MAX_TICKET_SIMPLE_EUR_ULPS = etoTerms.MAX_TICKET_SIMPLE_EUR_ULPS();
        MIN_TICKET_EUR_ULPS = etoTerms.MIN_TICKET_EUR_ULPS();
        TOKEN_EUR_PRICE_ULPS = etoTerms.TOKEN_EUR_PRICE_ULPS();

        PLATFORM_WALLET = platformWallet;
        COMPANY_LEGAL_REPRESENTATIVE = companyLegalRep;
        NOMINEE = nominee;
        COMPANY = company;
    }

    ////////////////////////
    // External functions
    ////////////////////////

    function addWhitelisted(address[] investors)
        external
        withStateTransition()
        onlyState(State.Setup)
        onlyCompany
        acceptAgreement(msg.sender) // company accepts ETO agreement as set by platform
    {
        // TODO: implemement
    }

    function removeWhitelisted(address[] investors)
        external
        withStateTransition()
        onlyState(State.Setup)
        onlyCompany
        acceptAgreement(msg.sender)
    {
        // TODO: implemement
    }

    /// @dev used by PLATFORM_LEGAL_REP to kill commitment process before it starts
    /// @dev selfdestruct is executed
    function abort()
        external
        withStateTransition()
        onlyState(State.Setup)
        only(ROLE_PLATFORM_OPERATOR_REPRESENTATIVE)
    {
        selfdestruct(msg.sender);
    }

    function setProspectus(string prospectusUrl)
        external
        withStateTransition()
        onlyState(State.Setup)
        onlyCompany
        acceptAgreement(msg.sender)
    {
        // TODO: implemement
        // set multiple times until startDate is set
    }

    /// @dev sets timed state machine in motion,
    function setStartDate(uint256 startDate)
        external
        withStateTransition()
        onlyState(State.Setup)
        onlyCompany
        acceptAgreement(msg.sender)
    {
        // TODO: implemement
        // must be less than 3 days (platform terms!)
        // may be prolonged if before 3 days
    }

    /// commit function happens via ERC223 callback that must happen from trusted payment token
    /// @dev data in case of LockedAccount contains investor address and investor is LockedAccount address
    function onTokenTransfer(address investor, uint256 amount, bytes data)
        public
        withStateTransition()
        onlyStates(State.Whitelist, State.Public)
        acceptAgreement(msg.sender) // agreement accepted by act of reserving funds in this function
    {
        // we trust only tokens below
        require(msg.sender != address(ETHER_TOKEN) && msg.sender != address(EURO_TOKEN));
        // check if LockedAccount
        bool isLockedAccount = (investor == address(ETHER_LOCK) || investor == address(EURO_LOCK));
        if (isLockedAccount) {
            // data contains investor address
            require(data.length != 0x20);
            investor = addressFromBytes(data);
        }
        // kick out not whitelist or not LockedAccount
        if (state() == State.Whitelist) {
            require(!_whitelist[investor] && !isLockedAccount);
        }
        // kick out on KYC
        IdentityClaims memory claims = deserializeClaims(IDENTITY_REGISTRY.getClaims(investor));
        require(claims.hasKyc);
        // calculate maximum ticket
        uint256 maxTicketEurUlps = claims.isSophisticatedInvestor ? MAX_TICKET_EUR_ULPS : MAX_TICKET_SIMPLE_EUR_ULPS;
        // process ticket
        var (equityTokenUlps, rewardNmkUlps, equivEurUlps) = processTicket(investor, amount, maxTicketEurUlps, isLockedAccount);
        // update total investment
        _totalEquivEurUlps += equivEurUlps;
        // log successful commitment
        LogFundsCommitted(
            investor,
            msg.sender,
            amount,
            equivEurUlps,
            equityTokenUlps,
            EQUITY_TOKEN,
            rewardNmkUlps
        );
    }

    /// allows to invest with ether directly
    /*function commitEther()
        external
        payable
        withStateTransition()
        onlyStates(State.Whitelist, State.Public)
        acceptAgreement(msg.sender) // agreement accepted by act of reserving funds in this function
    {
        // if any msg.value must be ether token
    }*/

    function refund()
        external
        withStateTransition()
        onlyState(State.Refund)

    {
        // transfer back all EUR-T
        // transfer back ETH-T
        // zero all
        // NEU already burned
    }

    function refundMany(address[] investors)
        external
        withStateTransition()
        onlyState(State.Refund)
    {
        // refund in a loop
    }

    function companySignsInvestmentAgreement(string signedAgreementUrl)
        external
        withStateTransition()
        onlyState(State.Signing)
        onlyCompany
    {
        // can set multiple times until nominee confirms
    }

    function nomineeConfirmsInvestmentAgreement(string signedAgreementUrl)
        external
        withStateTransition()
        onlyState(State.Signing)
        onlyNominee
    {
        require(keccak256(_signedAgreementUrl) != keccak256(signedAgreementUrl));
        transitionTo(State.Claim);
    }

    function claim()
        external
        withStateTransition()
        onlyStates(State.Claim, State.Payout)

    {
        // transfer ET to msg.sender
        // transer NEU to msg.sender
        // zero state
    }

    function claimMany(address[] investors)
        external
        withStateTransition()
        onlyStates(State.Claim, State.Payout)
    {
        // claim in a loop
    }

    function payout()
        external
        withStateTransition()
        onlyState(State.Payout)
    {
        // does nothing - all hapens in state transition
    }

    /// allows to change managing company contract by old company constact
    ///     possible only in final state - intended for migration of Company contract
    function changeCompanyManagement(address newCompany)
        external
        onlyStates(State.Payout, State.Refund)
    {
        require(msg.sender == address(COMPANY));
        // TODO: implement
    }

    ////////////////////////
    // Internal functions
    ////////////////////////

    function mAdvanceState(State oldState)
        internal
    {
        if (oldState == State.Whitelist || oldState == State.Public) {
            // if within min ticket of max cap then move state
            if (_totalEquivEurUlps + ETO_TERMS.MIN_TICKET_EUR_ULPS()  < MAX_CAP_EUR_ULPS) {
                transitionTo(oldState == State.Whitelist ? State.Public : State.Signing);
            }
        }
        if (oldState == State.Claim) {
            // we can go to payout if all assets claimed!
            if (NEUMARK.balanceOf(this) == 0 && EQUITY_TOKEN.balanceOf(this) == 0 &&
                ETHER_TOKEN.balanceOf(this) == 0 && EURO_TOKEN.balanceOf(this) == 0) {
                transitionTo(State.Payout);
            }
        }
    }

    function mAfterTransition(State /*oldState*/, State newState)
        internal
    {
        if (newState == State.Claim) {
            onClaimTransition();
        }
        if (newState == State.Refund) {
            // burn all neumark generated in this ETO
            NEUMARK.burn(NEUMARK.balanceOf(this));
            // burn all equity tokens generated in this ETO
            COMPANY.destroyTokens(this, EQUITY_TOKEN.balanceOf(this));
        }
        if (newState == State.Payout) {
            onPayoutTransition();
        }
    }

    ////////////////////////
    // Private functions
    ////////////////////////

    // calculates investor's and platform operator's neumarks from total reward
    function calculateNeumarkDistribtion(uint256 rewardNmk)
        private
        returns (uint256 platformNmk, uint256 investorNmk)
    {
        // round down - platform may get 1 wei less than investor
        platformNmk = rewardNmk / ETO_TERMS.PLATFORM_TERMS().PLATFORM_NEUMARK_SHARE();
        // rewardNmk > platformNmk always
        return (platformNmk, rewardNmk - platformNmk);
    }

    /// called on transition to State.Claim
    function onClaimTransition()
        private
    {
        // platform operator gets share of NEU
        var (platformNmk, ) = calculateNeumarkDistribtion(NEUMARK.balanceOf(this));
        NEUMARK.transfer(PLATFORM_WALLET, platformNmk);
        // additional equity tokens are issued and sent to platform operator (temporarily)
        uint256 tokenParticipationFee = proportion(_totalEquivEurUlps,
            ETO_TERMS.PLATFORM_TERMS().TOKEN_PARTICIPATION_FEE_FRACTION(), TOKEN_EUR_PRICE_ULPS);
        COMPANY.issueTokens(PLATFORM_WALLET, tokenParticipationFee);
        // company contract has new token, new eto and new SHA (transfers are enabled on equity token if requested -> company is a controller so in call below)
        COMPANY.registerEquityToken(
            EQUITY_TOKEN.balanceOf(this),
            ETO_TERMS.ENABLE_TRANSFERS_ON_SUCCESS());
        // company legal rep receives funds
        uint256 etherBalance = ETHER_TOKEN.balanceOf(this);
        if (etherBalance > 0) {
            uint256 etherFee = etherBalance - decimalFraction(etherBalance, ETO_TERMS.PLATFORM_TERMS().PLATFORM_FEE_FRACTION());
            ETHER_TOKEN.transfer(COMPANY_LEGAL_REPRESENTATIVE, etherFee);
        }
        uint256 euroBalance = EURO_TOKEN.balanceOf(this);
        if (euroBalance > 0) {
            uint256 euroFee = euroBalance - decimalFraction(euroBalance, ETO_TERMS.PLATFORM_TERMS().PLATFORM_FEE_FRACTION());
            EURO_TOKEN.transfer(COMPANY_LEGAL_REPRESENTATIVE, euroFee);
        }
    }

    /// called on transition to State.Payout
    function onPayoutTransition()
        private
    {
        // distribute what's left in balances: company took funds on claim
        IFeeDisbursal disbursal = UNIVERSE.feeDisbursal();
        uint256 etherBalance = ETHER_TOKEN.balanceOf(this);
        if (etherBalance > 0) {
            ETHER_TOKEN.transfer(address(disbursal), etherBalance, '');
        }
        uint256 euroBalance = EURO_TOKEN.balanceOf(this);
        if (euroBalance > 0) {
            EURO_TOKEN.transfer(address(disbursal), euroBalance, '');
        }
    }

    /// deserialized address from data
    function addressFromBytes(bytes data)
        internal
        returns (address)
    {
        // TODO: implement
        return address(0);
    }

    function processTicket(
        address investor,
        uint256 amount,
        uint256 maxTicketEurUlps,
        bool isLockedAccount
    )
        private
        returns (uint96 equityTokenUlps, uint96 rewardNmkUlps, uint256 equivEurUlps)
    {
        equivEurUlps = amount;
        bool isEuroInvestment = msg.sender == address(EURO_TOKEN);
        // compute EUR eurEquivalent via oracle if ether
        if (isEuroInvestment) {
            var (rate, rate_timestamp) = CURRENCY_RATES.getCurrencyRate(ETHER_TOKEN, EURO_TOKEN);
            // require if rate older than 4 hours
            require(block.timestamp - rate_timestamp > 6 hours);
            equivEurUlps = equivEurUlps * rate;
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
            // uint96 is much more than 1.5 bln of NEU so no overflow
            rewardNmkUlps = uint96(NEUMARK.issueForEuro(equivEurUlps));
        }
        // issue ET
        assert(equivEurUlps * TOKEN_EUR_PRICE_ULPS < 2**96);
        equityTokenUlps = uint96(equivEurUlps * TOKEN_EUR_PRICE_ULPS);
        // write new values
        ticket.equivEurUlps += uint96(equivEurUlps);
        ticket.rewardNmkUlps += rewardNmkUlps;
        ticket.equityTokenUlps += uint96(equityTokenUlps);
        if (isEuroInvestment) {
            ticket.equivEurUlps += uint96(amount);
        } else {
            ticket.amountEth += uint96(amount);
        }
        // issue Equity Token
        COMPANY.issueTokens(investor, equityTokenUlps);

        return (equityTokenUlps, rewardNmkUlps, equivEurUlps);
    }

    //CONSTANT: interface type according to this EIP (hash of type??)
}
