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
    // collection of interfaces that can disburse tokens: commitment contracts, token controllers
    bytes4[] private ALLOWED_DISBURSER_INTERFACES = [KNOWN_INTERFACE_COMMITMENT, KNOWN_INTERFACE_EQUITY_TOKEN_CONTROLLER];
    // collection of tokens that can be disbursed: payment tokens, equity tokens
    bytes4[] private ALLOWED_DISBURSAL_TOKEN_INTERFACES = [KNOWN_INTERFACE_PAYMENT_TOKEN,  KNOWN_INTERFACE_EQUITY_TOKEN];

    ////////////////////////
    // Immutable state
    ////////////////////////
    Universe private UNIVERSE;
    IAccessPolicy private ACCESS_POLICY;
    address private ETHER_LOCK;
    address private EURO_LOCK;
    address private NEUMARK;
    address private ICBM_ETHER_LOCK;
    address private ICBM_EURO_LOCK;

    ////////////////////////
    // Constructor
    ////////////////////////
    constructor(Universe universe)
        public
    {
        UNIVERSE = universe;
        // cache services that will never change to save some gas
        ACCESS_POLICY = universe.accessPolicy();
        ETHER_LOCK = universe.etherLock();
        EURO_LOCK = universe.euroLock();
        NEUMARK = universe.neumark();
        ICBM_ETHER_LOCK = universe.icbmEtherLock();
        ICBM_EURO_LOCK = universe.icbmEuroLock();
    }

    ////////////////////////
    // Public functions
    ////////////////////////

    //
    // IFeeDisbursalController Implementation
    //

    function onAccept(address /*token*/, address /*proRataToken*/, address claimer)
        public
        constant
        returns (bool allow)
    {
        return canClaim(claimer);
    }

    function onReject(address /*token*/, address /*proRataToken*/, address claimer)
        public
        constant
        returns (bool allow)
    {
        return canClaim(claimer);
    }

    function onDisburse(address token, address disburser, uint256 amount, address /*proRataToken*/, uint256 recycleAfterDuration)
        public
        constant
        returns (bool allow)
    {
        // who can disburse tokens: allowed collections + fee disbursal itself + locked accounts (which we cache to save gas)
        // or disburser has a disburer role (for example platform operator wallet)
        bool disburserAllowed = (disburser == EURO_LOCK || disburser == ETHER_LOCK || disburser == msg.sender) || (
            disburser == ICBM_EURO_LOCK || disburser == ICBM_ETHER_LOCK) || (
            UNIVERSE.isAnyOfInterfaceCollectionInstance(ALLOWED_DISBURSER_INTERFACES, disburser)) || (
            ACCESS_POLICY.allowed(disburser, ROLE_DISBURSER, msg.sender, msg.sig));
        return amount > 0 && isDisbursableToken(token) && disburserAllowed && recycleAfterDuration > 0;
    }

    function onRecycle(address /*token*/, address /*proRataToken*/, address[] /*investors*/, uint256 /*until*/)
        public
        constant
        returns (bool allow)
    {
        return true;
    }

    /// @notice check if feedisbursalcontroller may change
    /// @param newController instance of the new controller
    function onChangeFeeDisbursalController(address sender, IFeeDisbursalController newController)
        public
        constant
        returns (bool)
    {
        (bytes32 controllerContractId, ) = newController.contractId();
        return ACCESS_POLICY.allowed(sender, ROLE_DISBURSAL_MANAGER, msg.sender, msg.sig) && controllerContractId == FEE_DISBURSAL_CONTROLLER;
    }

    //
    // IContractId Implementation
    //

    function contractId()
        public
        pure
        returns (bytes32 id, uint256 version)
    {
        return (FEE_DISBURSAL_CONTROLLER, 0);
    }

    //
    // Other public methods
    //

    /// @notice helper to determine if the token at the given address is supported for disbursing
    /// @param token address of token in question
    function isDisbursableToken(address token)
        public
        constant
        returns (bool)
    {
        // all payment tokens + NEU (airdrops) + equity tokens (downrounds)
        return UNIVERSE.isAnyOfInterfaceCollectionInstance(ALLOWED_DISBURSAL_TOKEN_INTERFACES, token) || token == NEUMARK;
    }

    ////////////////////////
    // Private functions
    ////////////////////////

    function canClaim(address claimer)
        private
        constant
        returns (bool allow)
    {
        IIdentityRegistry registry = IIdentityRegistry(UNIVERSE.identityRegistry());
        IdentityClaims memory claims = deserializeClaims(registry.getClaims(claimer));
        return claims.isVerified && !claims.accountFrozen;
    }
}
