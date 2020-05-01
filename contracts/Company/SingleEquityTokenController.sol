pragma solidity 0.4.26;

import "../Reclaimable.sol";

import "./IEquityTokenController.sol";
import "./IControllerGovernance.sol";
import "./ControllerETO.sol";
import "./ControllerDividends.sol";
import "../Standards/IMigrationChain.sol";


/// @title on-chain company management with shareholder rights execution support
/// several simplifications apply:
/// - only single token is supported
/// - not all shareholder rights are yet supported
/// - secondary offering must be on the same token
contract SingleEquityTokenController is
    IControllerGovernance,
    IEquityTokenController,
    ControllerETO,
    ControllerDividends,
    IMigrationChain,
    IContractId
{
    ////////////////////////
    // Governance Module Id
    ////////////////////////

    bytes32 internal constant SingleEquityTokenControllerId = 0xcf797981ed83afa34271d9e461566e1f4faa04577471ac007890d663e1727723;
    uint256 internal constant SingleEquityTokenControllerV = 0;

    ////////////////////////
    // Immutable state
    ////////////////////////

    // old token controller
    address private OLD_TOKEN_CONTROLLER;

    ////////////////////////
    // Mutable state
    ////////////////////////

    // new controller when migrating
    IMigrationChain private _newController;

    // preserves state when migrating so cancel possible
    Gov.State private _preMigrationState;


    ////////////////////////
    // Constructor
    ////////////////////////

    constructor(
        Universe universe,
        address companyLegalRep
    )
        public
        ControllerGovernanceEngine(universe, companyLegalRep)
    {}

    //
    // Implements IControllerGovernance
    //

    function closeCompany()
        public
        onlyState(Gov.State.Closing)
    {
        revert("NF_NOT_IMPL");
    }

    function cancelCompanyClosing()
        public
        onlyState(Gov.State.Closing)
    {
        revert("NF_NOT_IMPL");
    }

    //
    // Implements IMigrationChain
    //

    function startMigrateTo(IMigrationChain newController)
        public
        onlyStates(Gov.State.Funded, Gov.State.Closed)
        // we allow account with that role to perform controller migrations, initially platform account is used
        // company may move to separate access policy contract and fully overtake migration control if they wish
        only(ROLE_COMPANY_UPGRADE_ADMIN)
    {
        require(newController != address(this));
        _preMigrationState = _g._state;
        transitionTo(Gov.State.Migrating);
    }

    function cancelMigrateTo()
        public
        onlyState(Gov.State.Migrating)
        only(ROLE_COMPANY_UPGRADE_ADMIN)
    {
        transitionTo(_preMigrationState);
        _preMigrationState = Gov.State.Setup;
    }

    function finishMigrateTo(IMigrationChain newController)
        public
        onlyState(Gov.State.Migrating)
        only(ROLE_COMPANY_UPGRADE_ADMIN)
    {
        require(newController != address(this));
        // must be migrated with us as a source
        require(newController.migratedFrom() == address(this), "NF_NOT_MIGRATED_FROM_US");
        _newController = newController;
        if (_t._token != address(0)) {
            _t._token.changeTokenController(newController);
        }
        transitionTo(Gov.State.Migrated);
        // emit LogResolutionExecuted(0, Action.ChangeTokenController);
        emit LogMigratedTo(address(this), newController);
    }

    function isMigrating()
        public
        constant
        returns (bool)
    {
        return _g._state == Gov.State.Migrating;
    }

    function migratedTo()
        public
        constant
        returns (IMigrationChain)
    {
        // _newController is set only in Migrated state, otherwise zero address is returned as required
        return _newController;
    }

    function migratedFrom()
        public
        constant
        returns (address)
    {
        return OLD_TOKEN_CONTROLLER;
    }

    //
    // Implements ITokenController
    //

    function onTransfer(address broker, address from, address to, uint256 amount)
        public
        constant
        returns (bool allow)
    {
        allow = _t._transferable;
        if (!allow) {
            // allow for initial token distribution by ETOCommitment contract (token claim)
            allow = ControllerETO.onTransfer(broker, from, to, amount);
        }
    }

    /// always approve
    function onApprove(address, address, uint256)
        public
        constant
        returns (bool allow)
    {
        return true;
    }

    function onChangeTokenController(address /*sender*/, address newController)
        public
        constant
        returns (bool)
    {
        return newController == address(_newController);
    }

    // no forced transfers allowed in this controller
    function onAllowance(address /*owner*/, address /*spender*/)
        public
        constant
        returns (uint256)
    {
        return 0;
    }

    //
    // Implements IEquityTokenController
    //

    function onChangeNominee(address, address, address)
        public
        constant
        returns (bool)
    {
        return false;
    }

    //
    // IControllerGovernance
    //

    function moduleId() public pure returns (bytes32[6] ids, uint256[6] versions) {
        return ([
            ControllerGovernanceEngineId,
            ControllerGeneralInformationId,
            ControllerEquityTokenId,
            ControllerETOId,
            ControllerDividendsId,
            SingleEquityTokenControllerId
        ],
        [
            ControllerGovernanceEngineV,
            ControllerGeneralInformationV,
            ControllerEquityTokenV,
            ControllerETOV,
            ControllerDividendsV,
            SingleEquityTokenControllerV
        ]);
    }

    //
    // IERC223TokenCallback (proceeds disbursal)
    //

    /// allows contract to receive and distribure proceeds
    function tokenFallback(address wallet, uint256 amount, bytes data)
        public
    {
        if(!ControllerDividends.receiveDividend(wallet, amount, data)) {
            revert("NF_UNEXPECTED_TOKEN_TX");
        }
    }

    //
    // Implements IContractId
    //

    function contractId() public pure returns (bytes32 id, uint256 version) {
        return (SingleEquityTokenControllerId, SingleEquityTokenControllerV);
    }

    //
    // Migration helper functions
    //

    // to be called on new controller to finalize migration and link old controller
    function finishMigrateFrom(IMigrationChain oldController, Gov.State oldControllerState)
        public
        onlyState(Gov.State.Setup)
        only(ROLE_COMPANY_UPGRADE_ADMIN)
    {
        // the last state of old controller before migration
        _g._state = oldControllerState;
        // link old controller
        OLD_TOKEN_CONTROLLER = oldController;
    }

    function preMigrationState()
        public
        onlyStates(Gov.State.Migrating, Gov.State.Migrated)
        constant
        returns (Gov.State)
    {
        return _preMigrationState;
    }
}
