pragma solidity 0.4.25;
import "../Universe.sol";
import "../Standards/IFeeDisbursalController.sol";
import "../Identity/IIdentityRegistry.sol";
import "../KnownInterfaces.sol";
import "../AccessControl/IAccessPolicy.sol";
import "../AccessRoles.sol";
import "../KnownContracts.sol";


/// @title granular fee disbursal controller
contract FeeDisbursalController is 
    IdentityRecord,
    IFeeDisbursalController,
    KnownInterfaces,
    AccessRoles,
    KnownContracts
{

    ////////////////////////
    // Constants
    ////////////////////////
    bytes4[] private DISBURSE_ALLOWED_INTERFACES = [KNOWN_INTERFACE_COMMITMENT, KNOWN_INTERFACE_EQUITY_TOKEN_CONTROLLER];


    ////////////////////////
    // Immutable state
    ////////////////////////
    Universe private UNIVERSE;
    IIdentityRegistry private IDENTITY_REGISTRY;
    IAccessPolicy private ACCESS_POLICY;
    address[] private ALLOWED_DISBURSABLE_TOKENS;

    ////////////////////////
    // Constructor
    ////////////////////////
    constructor(Universe universe)
        public
    {
        UNIVERSE = universe;
        IDENTITY_REGISTRY = IIdentityRegistry(universe.identityRegistry());
        ACCESS_POLICY = universe.accessPolicy();
        ALLOWED_DISBURSABLE_TOKENS = [UNIVERSE.etherToken(), UNIVERSE.euroToken(), UNIVERSE.neumark()];
    }

    ////////////////////////
    // Public functions
    ////////////////////////

    function onClaim(address token, address spender)
        public
        constant
        returns (bool allow)
    {
        IdentityClaims memory claims = deserializeClaims(IDENTITY_REGISTRY.getClaims(spender));
        return isDisbursableToken(token) && claims.isVerified && !claims.accountFrozen;
    }

    function onDisburse(address token, address disburser, uint256 amount, address proRataToken)
        public
        constant
        returns (bool allow)
    {   
        //@TODO: should we dissalow token and pro rata token to be the same?
        bool disburserAllowed = 
            UNIVERSE.isAnyOfInterfaceCollectionInstance(DISBURSE_ALLOWED_INTERFACES, disburser) ||
            ACCESS_POLICY.allowed(disburser, ROLE_DISBURSER, 0x0, msg.sig);
        return amount > 0 && isDisbursableToken(token) && disburserAllowed;
    }

    function onRecycle()
        public
        constant
        returns (bool allow)
    {
        return true;
    }

    /// @notice helper to determine if the token at the given address is supported for disbursing
    /// @param token address of token in question
    function isDisbursableToken(address token)
        public
        constant
        returns (bool)
    {   
        // @TODO: migrate this to new, more flexible token registering Reclaimable in universe
        for (uint256 i = 0; i < ALLOWED_DISBURSABLE_TOKENS.length; i++)
            if (token == ALLOWED_DISBURSABLE_TOKENS[i]) return true;
        return false;
    }

    /// @notice check if feedisbursalcontroller may change
    /// @param newController instance of the new controller
    function onChangeFeeDisbursalController(IFeeDisbursalController newController)
        public
        constant
        returns (bool)
    {
        (bytes32 controllerContractId, ) = newController.contractId();
        require(controllerContractId == FEE_DISBURSAL_CONTROLLER);
        return ACCESS_POLICY.allowed(msg.sender, ROLE_DISBURSAL_MANAGER, 0x0, msg.sig);
    }

    // implementation of ContractId
    function contractId()
        public
        pure
        returns (bytes32 id, uint256 version) {
        return (FEE_DISBURSAL_CONTROLLER, 0);
    }


}
