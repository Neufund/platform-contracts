pragma solidity 0.4.23;
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
    mapping(bytes4 =>
        mapping(address => bool)) private _collections; // solium-disable-line indentation

    // known instances
    mapping(address => bytes4[]) private _instances;


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

    /// gets all interfaces of given instance
    function getInterfacesOfInstance(address instance)
        public
        constant
        returns (bytes4[] interfaces)
    {
        return _instances[instance];
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
        setCollectionPrivate(interfaceId, instance, set);
    }

    /// set or unset 'instance' in many collections of instances
    function setInterfaceInManyCollections(bytes4[] interfaceIds, address instance, bool set)
        public
        only(ROLE_UNIVERSE_MANAGER)
    {
        uint256 idx;
        while(idx < interfaceIds.length) {
            setCollectionPrivate(interfaceIds[idx], instance, set);
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
        // do nothing if not changing
        if (_singletons[interfaceId] == instance) {
            return;
        }
        dropInstance(_singletons[interfaceId], interfaceId);
        addInstance(instance, interfaceId);
        _singletons[interfaceId] = instance;
        emit LogSetSingleton(interfaceId, instance);
    }

    function setCollectionPrivate(bytes4 interfaceId, address instance, bool set)
        private
    {
        // do nothing if not changing
        if (_collections[interfaceId][instance] == set) {
            return;
        }
        _collections[interfaceId][instance] = set;
        if (set) {
            addInstance(instance, interfaceId);
        } else {
            dropInstance(instance, interfaceId);
        }
        emit LogSetCollectionInterface(interfaceId, instance, set);
    }

    function addInstance(address instance, bytes4 interfaceId)
        private
    {
        if (instance == address(0)) {
            // do not add null instance
            return;
        }
        bytes4[] storage current = _instances[instance];
        uint256 idx;
        while(idx < current.length) {
            // instancy has this interface already, do nothing
            if (current[idx] == interfaceId)
                return;
            idx += 1;
        }
        // new interface
        current.push(interfaceId);
    }

    function dropInstance(address instance, bytes4 interfaceId)
        private
    {
        if (instance == address(0)) {
            // do not drop null instance
            return;
        }
        bytes4[] storage current = _instances[instance];
        uint256 idx;
        uint256 last = current.length - 1;
        while(idx <= last) {
            if (current[idx] == interfaceId) {
                // delete element
                if (idx < last) {
                    // if not last element move last element to idx being deleted
                    current[idx] = current[last];
                }
                // delete last element
                current.length -= 1;
                return;
            }
            idx += 1;
        }
    }
}
