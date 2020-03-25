pragma solidity 0.4.26;

import "../../ETO/IETOCommitment.sol";
import "../../Agreement.sol";
import "../../Universe.sol";


contract TestETOCommitmentPlaceholderTokenController is
    IETOCommitmentStates,
    Agreement
{

    ////////////////////////
    // Immutable State
    ////////////////////////

    // equity token issued
    IEquityToken private EQUITY_TOKEN;
    // company representative address
    address private COMPANY_LEGAL_REPRESENTATIVE;
    // nominee address
    address private NOMINEE;
    // terms contracts
    ETOTerms private ETO_TERMS;
    // observer receives notifications on all state changes
    IETOCommitmentObserver private COMMITMENT_OBSERVER;

    ////////////////////////
    // Immutable State
    ////////////////////////

    // keeps current ETO state
    ETOState private _state;

    // keeps state transitions timestamps
    uint256[8] private _stateTransitions;

    ////////////////////////
    // Constructor
    ////////////////////////

    constructor(
        Universe universe,
        address nominee,
        address companyLegalRep,
        ETOTerms etoTerms
    )
        public
        Agreement(universe.accessPolicy(), universe.forkArbiter())
    {
        ETO_TERMS = etoTerms;
        COMPANY_LEGAL_REPRESENTATIVE = companyLegalRep;
        NOMINEE = nominee;
    }

    ////////////////////////
    // Public Methods
    ////////////////////////

    function setStartDate(ETOTerms /*etoTerms*/, IEquityToken equityToken, uint256 /*startDate*/) public {
        EQUITY_TOKEN = equityToken;
        COMMITMENT_OBSERVER = IETOCommitmentObserver(EQUITY_TOKEN.tokenController());
    }

    //
    // Public Methods required by registerTokenOfferingPrivate in Placeholder Token Controller
    //

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

    function commitmentObserver() public constant returns (IETOCommitmentObserver) {
        return COMMITMENT_OBSERVER;
    }

    //
    // Public Methods required by approveTokenOfferingPrivate in Placeholder Token Controller
    //

    function signedInvestmentAgreementUrl()
        public
        pure
        returns (string)
    {
        return "RAAAAA";
    }

    function contributionSummary()
        public
        constant
        returns (
            uint256 newShares, uint256 capitalIncreaseUlps,
            uint256, uint256,
            uint256, uint256, uint256,
            uint256
        )
    {
        // compute new shares directly from number of tokens
        newShares = EQUITY_TOKEN.balanceOf(address(this)) / ETO_TERMS.TOKEN_TERMS().EQUITY_TOKENS_PER_SHARE();
        // compute capital increase from token terms
        capitalIncreaseUlps = newShares * ETO_TERMS.TOKEN_TERMS().SHARE_NOMINAL_VALUE_ULPS();
        // no more is needed
    }

    //
    // partial implementation of state machine
    //
    // to provide basic state information
    //

    function state() public constant returns (ETOState) {
        return _state;
    }

    // returns start of given state
    function startOf(ETOState s) public constant returns (uint256) {
        return _stateTransitions[uint256(s)];
    }

    //
    // Methods to poke controller in various ways
    //

    function _triggerStateTransition(ETOState prevState, ETOState newState)
        public
    {
        _state = newState;
        _stateTransitions[uint256(_state)] = block.timestamp;
        COMMITMENT_OBSERVER.onStateTransition(prevState, newState);
    }

    function _generateTokens(uint256 amount)
        public
    {
        EQUITY_TOKEN.issueTokens(amount);
    }

    function _destroyTokens(uint256 amount)
        public
    {
        EQUITY_TOKEN.destroyTokens(amount);
    }

    function _distributeTokens(address to, uint256 amount)
        public
    {
        EQUITY_TOKEN.distributeTokens(to, amount);
    }

    ////////////////////////
    // Internal Methods
    ////////////////////////

    //
    // Overrides Agreement internal interface
    //

    function mCanAmend(address legalRepresentative)
        internal
        returns (bool)
    {
        return legalRepresentative == NOMINEE;
    }
}
