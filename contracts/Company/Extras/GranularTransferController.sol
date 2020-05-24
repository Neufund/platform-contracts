pragma solidity 0.4.26;

import "../SingleEquityTokenController.sol";


contract GranularTransferController is
    SingleEquityTokenController
{
    ////////////////////////
    // Type declarations
    ////////////////////////

    /// represents right to force transfer by the company
    struct ForcedTransfer {
        // to account
        address to;
        // amount
        uint256 amount;
    }

    ////////////////////////
    // Mutable state
    ////////////////////////

    // keeps list of frozen addresses that cannot transfer or receive transfers
    mapping(address => bool) private _frozenAddresses;

    // list of available forced transfers (from => ForcedTransfer)
    mapping(address => ForcedTransfer) private _forcedTransfers;

    ////////////////////////
    // Events
    ////////////////////////

    event LogForcedTransferEnabled(
        address from,
        address to,
        uint256 amount
    );

    event LogForcedTransferExecuted(
        address token,
        address from,
        address to,
        uint256 amount
    );

    event LogTokenHolderAccountFrozen(
        address owner
    );

    event LogTokenHolderAccountUnfrozen(
        address owner
    );

    ////////////////////////
    // Constructor
    ////////////////////////

    constructor(
        Universe universe,
        address companyLegalRep
    )
        public
        SingleEquityTokenController(universe, companyLegalRep)
    {}

    //
    // Implements ITokenController
    //

    function onTransfer(address broker, address from, address to, uint256 amount)
        public
        constant
        returns (bool allow)
    {
        Gov.State s = _g._state;
        // allow forced transfer only by the token controller itself
        if ((s == Gov.State.Funded || s == Gov.State.Closing) && broker == address(this)) {
            ForcedTransfer storage t = _forcedTransfers[from];
            // check if forced transfer matches the actual transfer
            if (t.amount > 0) {
                // we allow because we checked the following
                //  (1) the broker is the company
                //  (2) there's forced transfer defined for from address
                //  (3) there's a match for to and amount

                // we return immediately as we'll not check frozen accounts in that case
                // often it may happend that from address is already frozen
                return t.amount == amount && t.to == to;
            }
        }
        // ask base controller if transfers are enabled
        allow = SingleEquityTokenController.onTransfer(broker, from, to, amount);
        // prevent transfer if account is frozen
        if (allow && s == Gov.State.Funded) {
            allow = !(_frozenAddresses[from] || _frozenAddresses[to] || _frozenAddresses[broker]);
        }
    }

    function onAllowance(address owner, address spender)
        public
        constant
        returns (uint256)
    {
        uint256 overrideAmount = SingleEquityTokenController.onAllowance(owner, spender);
        // if no override was set by base class check frozen transfer override
        // the spender must be token controller - this contract
        if (overrideAmount == 0 && spender == address(this)) {
            // return amount that can be force-transferred
            return _forcedTransfers[owner].amount;
        }
    }

    //
    // Overrides IContract
    //

    // return same contractId as base class, but mark version as special
    function contractId() public pure returns (bytes32 id, uint256 version) {
        return (0xcf797981ed83afa34271d9e461566e1f4faa04577471ac007890d663e1727723, 0xFF);
    }

    ////////////////////////
    // Public functions
    ////////////////////////

    /// note: allow forced transfer `from` -> `to` with `amount`
    /// dev: actual execution happens via executeForcedTransfer and this contracts is a broker
    function enableForcedTransfer(address from, address to, uint256 amount)
        public
        onlyCompany
    {
        // announce that transfer will happen via emit
        // setup the transfer
        _forcedTransfers[from] = ForcedTransfer({to: to, amount: amount});
        emit LogForcedTransferEnabled(from, to, amount);
    }

    /// note: forced transfer direct initiator is always this contract instance, this allows a full control over
    ///       forced transfer execution in atomic transaction
    /// dev: method is public. once right to forced transfer is established anyone can execute it. cool isn't it?
    function executeForcedTransfer(address from)
        public
    {
        // make a local copy
        ForcedTransfer memory t = _forcedTransfers[from];
        // force transfer right must be established
        require(t.amount > 0, "NF_FORCED_T_NOT_EXISTS");
        // note: here we consider putting a due date for the transfer to enforce gap between transfer
        //      announcement and actual execution
        //require(now - t.block > 7 days, "NF_FORCED_T_NOT_DUE");
        // obtain equity token address
        IControlledToken token = _t._token;
        // execute forced transfer with this smart contract as a broker
        // this will trigger onAllowance and onTranfer controller method before completing
        require(token.transferFrom(from, t.to, t.amount));
        // cleanup storage, no re-entry risk
        delete _forcedTransfers[from];
        // emit forced transfer executed
        emit LogForcedTransferExecuted(token, from, t.to, t.amount);
        // note that forced transfer was removed, there's no way it can be executed twice
    }

    function freezeHolder(address owner)
        public
        onlyCompany
    {
        _frozenAddresses[owner] = true;
        emit LogTokenHolderAccountFrozen(owner);

    }

    function unfreezeHolder(address owner)
        public
        onlyCompany
    {
        _frozenAddresses[owner] = false;
        emit LogTokenHolderAccountUnfrozen(owner);

    }
}
