pragma solidity 0.4.26;

import "../../Math.sol";
import "../../Universe.sol";
import "../../Agreement.sol";
import "../../Reclaimable.sol";

import "../IEquityTokenController.sol";
import "../IEquityToken.sol";
import "../../ETO/IETOCommitment.sol";
import "../../Standards/IContractId.sol";

/*
To test:
* Disbursal by nominee
* 
 */

contract ExitController is
    KnownInterfaces,
    Reclaimable,
    Agreement
{

    ////////////////////////
    // Events
    ////////////////////////

    /// log state transitions
    event LogStateTransition(
        uint32 oldState,
        uint32 newState,
        uint32 timestamp
    );

    event LogProceedsPayed(
        address investor,
        uint256 amountEquityTokens,
        uint256 amountPayed
    );

    event LogProceedsManuallyResolved(
        address lostAddress,
        address newAddress,
        uint256 amountEquityTokens,
        uint256 amountPayed
    );

    ////////////////////////
    // Types
    ////////////////////////

    // defines state machine of the exit controller
    enum State {
        Setup, // Initial state
        Payout, // Users can claim eur-t for tokens
        ManualPayoutResolution // Nominee can manually resolve payouts, user initiated payout is disabled
    }

    ////////////////////////
    // Immutable state
    ////////////////////////

    // a root of trust contract
    Universe private UNIVERSE;
    IERC223Token private EURO_TOKEN;
    // equity token from ETO
    IEquityToken private EQUITY_TOKEN;

    ////////////////////////
    // Mutable state
    ////////////////////////

    // controller lifecycle state
    State private _state;

    // exit values get set when exit proceedings start
    uint256 private _exitEquityTokenSupply = 0;
    uint256 private _exitAquisitionPriceEurUlps = 0;
    uint256 private _manualPayoutResolutionStart = 0;

    // keep record of manually resolved payout
    mapping(address => bool) private payoutManuallyResolved;

    ////////////////////////
    // Modifiers
    ////////////////////////

    ////////////////////////
    // Constructor
    ////////////////////////

    constructor(
        Universe universe,
        IEquityToken equityToken,
        address companyLegalRep
    )
        public
        Agreement(universe.accessPolicy(), universe.forkArbiter())
    {
        UNIVERSE = universe;
        EURO_TOKEN = UNIVERSE.euroToken();
        EQUITY_TOKEN = equityToken;
        _state = State.Setup;
    }

    //
    // Implements IControllerGovernance
    //
    function state()
        public
        constant
        returns (State)
    {
        return _state;
    }

    // calculate how many eurotokens one would receive for the given amount of tokens
    function eligibleProceedsForTokens(uint256 amountTokens)
        public
        constant
        returns (uint256)
    {
        if (_state == State.Setup ) {
            return 0;
        }
        // calculate the amount of eligible proceeds based on the total equity token supply and the 
        // acquisition price
        return Math.mul(_exitAquisitionPriceEurUlps, amountTokens) / _exitEquityTokenSupply;
    }

    // calculate how many eurotokens the user with the given address would receive
    function eligibleProceedsForInvestor(address investor)
        public
        constant
        returns (uint256 equityTokens, uint256 proceeds) 
    {
        equityTokens = 0;
        proceeds = 0;

        if (payoutManuallyResolved[investor]) {
            return;
        }

        if (_state == State.Payout) {
            equityTokens = EQUITY_TOKEN.balanceOf(investor);
        }
        else if (_state == State.ManualPayoutResolution) {
            equityTokens = EQUITY_TOKEN.balanceOfAt(investor, _manualPayoutResolutionStart);
        }
        proceeds = eligibleProceedsForTokens(equityTokens);
        return (equityTokens, proceeds);
    }

    //
    // IERC223TokenCallback (exit proceeds disbursal)
    //

    /// allows contract to receive and distribute proceeds
    /// this can only be done in the funded state
    function tokenFallback(address from, uint256 amount, bytes)
        public
    {   
        require(amount > 0, "NF_NOTHING_SENT");

        // if we're in the setup state, this contract is waiting
        // for the nominee to send the exit funds
        if (_state == State.Setup) {
            // we only allow eurotokens for this operation
            require(msg.sender == address(EURO_TOKEN), "NF_ETO_UNK_TOKEN");
            // only the nominee may send proceeds to this contract
            require(from == EQUITY_TOKEN.nominee(), "NF_ONLY_NOMINEE");
            // start the payout
            startPayout();
        }   
        // when we already are in the closing state, investors can send
        // their tokens to  be burned and converted to euro token
        else if ( _state == State.Payout ) {
            // now we only allow conversion of the tokens into neumarks
            require(msg.sender == address(EQUITY_TOKEN), "NF_ETO_UNK_TOKEN");
            // investor must have sent all of his tokens
            require(EQUITY_TOKEN.balanceOf(from) == 0, "NF_MUST_SEND_ALL_TOKENS");
            // payout exit proceeds
            payExitProceeds(from, amount);
        } else {
            revert("UNEXPECTED_OPERATION");
        }
    }

    function startManualPayoutResolution()
        public
    {
        require(msg.sender == EQUITY_TOKEN.nominee(), "NF_NO_ACCESS");
        transitionTo(State.ManualPayoutResolution);
        _manualPayoutResolutionStart = block.timestamp;
    }

    function payoutManually(address lostWallet, address newWallet)
        public
    {   
        // only the nominee may do manual payouts
        require(msg.sender == EQUITY_TOKEN.nominee(), "NF_NO_ACCESS");
        // we need a valid receiver address
        require(newWallet != 0x0, "NF_INVALID_NEW_WALLET");
        // we can only process wallets that have not been manually resolved yet
        require(payoutManuallyResolved[lostWallet] == false, "NF_ALREADY_PAYED_OUT");
        require(_state == State.ManualPayoutResolution, "NF_INCORRECT_STATE");

        (uint256 _tokens, uint256 _proceeds) = eligibleProceedsForInvestor(lostWallet);
        payoutManuallyResolved[lostWallet] = true;
        EURO_TOKEN.transfer(newWallet, _proceeds, "");
        emit LogProceedsManuallyResolved(lostWallet, newWallet, _tokens, _proceeds);
    }
    

    //
    // Implements IContractId
    // 

    // TODO!
    function contractId() public pure returns (bytes32 id, uint256 version) {
        return (0x0, 1);
    }

    ////////////////////////
    // Internal functions
    ////////////////////////

    function transitionTo(State newState)
        internal
    {
        emit LogStateTransition(uint32(_state), uint32(newState), uint32(block.timestamp));
        _state = newState;
    }

    ////////////////////////
    // Private functions
    ////////////////////////    

    // start the exit when nominee sends exit funds
    function startPayout()
        private
    {   
        // get total number of equity tokens
        _exitEquityTokenSupply = EQUITY_TOKEN.totalSupply();
        // get the total exit amount in eur-t for the given euqity tokens
        _exitAquisitionPriceEurUlps = EURO_TOKEN.balanceOf(this);
        // mark the company as closing, in our case this means "exiting"
        transitionTo(State.Payout);
    }

    // pay exit proceeds to an individual user
    function payExitProceeds(address investor, uint256 equityTokenAmount)
        private
    {
        // payout euro tokens to investor
        uint256 _eligibleProceeds = eligibleProceedsForTokens(equityTokenAmount);
        EURO_TOKEN.transfer(investor, _eligibleProceeds, "");
        emit LogProceedsPayed(investor, equityTokenAmount, _eligibleProceeds);
    }

}