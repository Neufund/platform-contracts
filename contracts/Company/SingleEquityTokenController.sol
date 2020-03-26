pragma solidity 0.4.26;

import "../Reclaimable.sol";

import "./IEquityTokenController.sol";
import "./ControllerGovernanceBase.sol";
import "./ControllerTokenOfferings.sol";
import "../Standards/IContractId.sol";
import "../Standards/IMigrationChain.sol";


/// @title on-chain company management with shareholder rights execution support
/// several simplifications apply:
/// - only single token is supported
/// - not all shareholder rights are yet supported
/// - single offering only supported
contract SingleEquityTokenController is
    IEquityTokenController,
    ControllerTokenOfferings,
    IMigrationChain,
    IContractId
{
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
    GovState private _preMigrationState;


    ////////////////////////
    // Constructor
    ////////////////////////

    constructor(
        Universe universe,
        address companyLegalRep,
        IETOCommitment commitment
    )
        public
        ControllerGovernanceBase(universe, companyLegalRep)
    {
        if (commitment != address(0)) {
            // initialize new offering accepting off-chain shareholder resolution
            bytes32 resolutionId = keccak256(abi.encodePacked(address(commitment)));
            startNewOffering(resolutionId, commitment);
        }
    }

    //
    // Implements IControllerGovernance
    //

    function closeCompany()
        public
        onlyState(GovState.Closing)
    {
        revert("NF_NOT_IMPL");
    }

    function cancelCompanyClosing()
        public
        onlyState(GovState.Closing)
    {
        revert("NF_NOT_IMPL");
    }

    //
    // Implements IMigrationChain
    //

    function startMigrateTo(IMigrationChain newController)
        public
        onlyStates(GovState.Funded, GovState.Closed)
        // we allow account with that role to perform controller migrations, initially platform account is used
        // company may move to separate access policy contract and fully overtake migration control if they wish
        only(ROLE_COMPANY_UPGRADE_ADMIN)
    {
        require(newController != address(this));
        _preMigrationState = _state;
        transitionTo(GovState.Migrating);
    }

    function cancelMigrateTo()
        public
        onlyState(GovState.Migrating)
        only(ROLE_COMPANY_UPGRADE_ADMIN)
    {
        transitionTo(_preMigrationState);
        _preMigrationState = GovState.Setup;
    }

    function finishMigrateTo(IMigrationChain newController)
        public
        onlyState(GovState.Migrating)
        only(ROLE_COMPANY_UPGRADE_ADMIN)
    {
        require(newController != address(this));
        // must be migrated with us as a source
        require(newController.migratedFrom() == address(this), "NF_NOT_MIGRATED_FROM_US");
        _newController = newController;
        transitionTo(GovState.Migrated);
        // emit LogResolutionExecuted(0, Action.ChangeTokenController);
        emit LogMigratedTo(address(this), newController);
    }

    function isMigrating()
        public
        constant
        returns (bool)
    {
        return _state == GovState.Migrating;
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

    function onTransfer(address broker, address from, address /*to*/, uint256 /*amount*/)
        public
        constant
        returns (bool allow)
    {
        // allow for initial token distribution by ETOCommitment contract (token claim)
        if (from == _commitment && broker == from) {
            allow = true;
        } else {
            allow = _transfersEnabled;
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

    function onGenerateTokens(address sender, address, uint256)
        public
        constant
        returns (bool allow)
    {
        return _state == GovState.Offering && isActiveOffering(sender);
    }

    function onDestroyTokens(address sender, address, uint256)
        public
        constant
        returns (bool allow)
    {
        return _state == GovState.Offering && isActiveOffering(sender);
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
    // IERC223TokenCallback (proceeds disbursal)
    //

    /// allows contract to receive and distribure proceeds
    function tokenFallback(address, uint256, bytes)
        public
    {
        revert("NF_NOT_IMPL");
    }

    //
    // Implements IContractId
    //

    function contractId() public pure returns (bytes32 id, uint256 version) {
        return (0xcf797981ed83afa34271d9e461566e1f4faa04577471ac007890d663e1727723, 0);
    }

    //
    // Migration helper functions
    //

    // to be called on new controller to finalize migration and link old controller
    function finishMigrateFrom(IMigrationChain oldController, GovState oldControllerState)
        public
        onlyState(GovState.Setup)
        only(ROLE_COMPANY_UPGRADE_ADMIN)
    {
        // the last state of old controller before migration
        _state = oldControllerState;
        // link old controller
        OLD_TOKEN_CONTROLLER = oldController;
    }

    function preMigrationState()
        public
        onlyStates(GovState.Migrating, GovState.Migrated)
        constant
        returns (GovState)
    {
        return _preMigrationState;
    }
}
