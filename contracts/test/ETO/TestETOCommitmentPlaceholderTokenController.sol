pragma solidity 0.4.25;

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
    // Constructor
    ////////////////////////

    constructor(
        Universe universe,
        address nominee,
        address companyLegalRep,
        ETOTerms etoTerms,
        IEquityToken equityToken
    )
        public
        Agreement(universe.accessPolicy(), universe.forkArbiter())
    {
        ETO_TERMS = etoTerms;
        EQUITY_TOKEN = equityToken;
        COMPANY_LEGAL_REPRESENTATIVE = companyLegalRep;
        NOMINEE = nominee;
        COMMITMENT_OBSERVER = IETOCommitmentObserver(EQUITY_TOKEN.tokenController());
    }

    ////////////////////////
    // Public Methods
    ////////////////////////

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
            uint256 newShares, uint256,
            uint256, uint256,
            uint256, uint256, uint256,
            uint256
        )
    {
        // only newShares are needed by Placeholder token controller
        newShares = EQUITY_TOKEN.balanceOf(address(this)) / ETO_TERMS.TOKEN_TERMS().EQUITY_TOKENS_PER_SHARE();
    }

    //
    // Methods to poke controller in various ways
    //

    function _triggerStateTransition(ETOState prevState, ETOState newState)
        public
    {
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
