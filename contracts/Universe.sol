pragma solidity 0.4.15;
import "./Neumark.sol";
import "./KnownInterfaces.sol";
import "./AccessRoles.sol";

import "./Identity/IIdentityRegistry.sol";
import "./Standards/IERC223Token.sol";
import "./Standards/ITokenExchangeRateOracle.sol";
import "./Standards/IFeeDisbursal.sol";
import "./Standards/IEthereumForkArbiter.sol";


/// @title root of trust and singletons + known interface registry
/// provides a root which holds all interfaces platform trust, this includes
/// singletons - for which accessors are provided
/// collections of known instances of interfaces
/// @dev interfaces are identified by bytes4, see KnownInterfaces.sol
contract Universe is
    AccessControlled,
    KnownInterfaces,
    AccessRoles
{
    ////////////////////////
    // Events
    ////////////////////////

    /// raised on any change of singleton instance
    event LogSetSingleton(
        bytes4 interfaceId,
        address instance
    );

    /// raised on add/remove interface instance in collection
    event LogSetCollectionInterface(
        bytes4 interfaceId,
        address instance,
        bool isSet
    );

    ////////////////////////
    // Mutable state
    ////////////////////////

    // mapping of known contracts to addresses of singletons
    mapping(bytes4 => address) private _singletons;

    // mapping of known interfaces to collections of contracts
    mapping(bytes4 => mapping(address => bool)) private _collections;


    ////////////////////////
    // Constructor
    ////////////////////////

    function Universe(
        IAccessPolicy accessPolicy,
        IEthereumForkArbiter forkArbiter
    )
        AccessControlled(accessPolicy)
        public
    {
        setSingletonPrivate(KNOWN_INTERFACE_ACCESS_POLICY, accessPolicy);
        setSingletonPrivate(KNOWN_INTERFACE_FORK_ARBITER, forkArbiter);
    }

    ////////////////////////
    // Public methods
    ////////////////////////

    /// get singleton instance for 'interfaceId'
    function getSingleton(bytes4 interfaceId)
        public
        constant
        returns (address)
    {
        return _singletons[interfaceId];
    }

    function getManySingletons(bytes4[] interfaceIds)
        public
        constant
        returns (address[])
    {
        address[] memory addresses = new address[](interfaceIds.length);
        uint256 idx;
        while(idx < interfaceIds.length) {
            addresses[idx] = _singletons[interfaceIds[idx]];
            idx += 1;
        }
        return addresses;
    }

    /// checks of 'instance' is instance of interface 'interfaceId'
    function isSingleton(bytes4 interfaceId, address instance)
        public
        constant
        returns (bool)
    {
        return _singletons[interfaceId] == instance;
    }

    /// checks if 'instance' is one of instances of 'interfaceId'
    function isInterfaceCollectionInstance(bytes4 interfaceId, address instance)
        public
        constant
        returns (bool)
    {
        return _collections[interfaceId][instance];
    }

    /// sets 'instance' of singleton with interface 'interfaceId'
    function setSingleton(bytes4 interfaceId, address instance)
        public
        only(ROLE_UNIVERSE_MANAGER)
    {
        setSingletonPrivate(interfaceId, instance);
    }

    /// convenience method for setting many singleton instances
    function setManySingletons(bytes4[] interfaceIds, address[] instances)
        public
        only(ROLE_UNIVERSE_MANAGER)
    {
        require(interfaceIds.length == instances.length);
        uint256 idx;
        while(idx < interfaceIds.length) {
            setSingletonPrivate(interfaceIds[idx], instances[idx]);
            idx += 1;
        }
    }

    /// set or unset 'instance' with 'interfaceId' in collection of instances
    function setCollectionInterface(bytes4 interfaceId, address instance, bool set)
        public
        only(ROLE_UNIVERSE_MANAGER)
    {
        _collections[interfaceId][instance] = set;
        LogSetCollectionInterface(interfaceId, instance, set);
    }

    /// set or unset 'instance' in many collections of instances
    function setInterfaceInManyCollections(bytes4[] interfaceIds, address instance, bool set)
        public
        only(ROLE_UNIVERSE_MANAGER)
    {
        uint256 idx;
        while(idx < interfaceIds.length) {
            _collections[interfaceIds[idx]][instance] = set;
            LogSetCollectionInterface(interfaceIds[idx], instance, set);
        }
    }

    ////////////////////////
    // Getters
    ////////////////////////

    function accessPolicy() public constant returns (IAccessPolicy) {
        return IAccessPolicy(_singletons[KNOWN_INTERFACE_ACCESS_POLICY]);
    }

    function forkArbiter() public constant returns (IEthereumForkArbiter) {
        return IEthereumForkArbiter(_singletons[KNOWN_INTERFACE_FORK_ARBITER]);
    }

    function neumark() public constant returns (Neumark) {
        return Neumark(_singletons[KNOWN_INTERFACE_NEUMARK]);
    }

    function etherToken() public constant returns (IERC223Token) {
        return IERC223Token(_singletons[KNOWN_INTERFACE_ETHER_TOKEN]);
    }

    function euroToken() public constant returns (IERC223Token) {
        return IERC223Token(_singletons[KNOWN_INTERFACE_EURO_TOKEN]);
    }

    function etherLock() public constant returns (address) {
        return _singletons[KNOWN_INTERFACE_ETHER_LOCK];
    }

    function euroLock() public constant returns (address) {
        return _singletons[KNOWN_INTERFACE_EURO_LOCK];
    }

    function icbmEtherLock() public constant returns (address) {
        return _singletons[KNOWN_INTERFACE_ICBM_ETHER_LOCK];
    }

    function icbmEuroLock() public constant returns (address) {
        return _singletons[KNOWN_INTERFACE_ICBM_EURO_LOCK];
    }

    function identityRegistry() public constant returns (IIdentityRegistry) {
        return IIdentityRegistry(_singletons[KNOWN_INTERFACE_IDENTITY_REGISTRY]);
    }

    function tokenExchangeRateOracle() public constant returns (ITokenExchangeRateOracle) {
        return ITokenExchangeRateOracle(_singletons[KNOWN_INTERFACE_TOKEN_EXCHANGE_RATE_ORACLE]);
    }

    function feeDisbursal() public constant returns (IFeeDisbursal) {
        return IFeeDisbursal(_singletons[KNOWN_INTERFACE_FEE_DISBURSAL]);
    }

    function tokenExchange() public constant returns (address) {
        return address(_singletons[KNOWN_INTERFACE_TOKEN_EXCHANGE]);
    }

    function gasExchange() public constant returns (address) {
        return address(_singletons[KNOWN_INTERFACE_GAS_EXCHANGE]);
    }

    ////////////////////////
    // Private methods
    ////////////////////////

    function setSingletonPrivate(bytes4 interfaceId, address instance)
        private
    {
        _singletons[interfaceId] = instance;
        LogSetSingleton(interfaceId, instance);
    }
}
