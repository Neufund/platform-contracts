pragma solidity 0.4.15;

import "./EthereumForkArbiter.sol";
import "./EtherToken.sol";
import "./EuroToken.sol";
import "./Neumark.sol";
import "./ICBM/LockedAccount.sol";

// TODO: should import actual implementations
import "./Identity/IIdentityRegistry.sol";
import "./Standards/ICurrencyRateOracle.sol";
import "./Standards/IFeeDisbursal.sol";

// TODO: should be based on interfaces discovery like EIP 156
contract Universe is AccessControlled {

    ////////////////////////
    // Immutable state
    ////////////////////////

    // platform wide access policy
    IAccessPolicy private ACCESS_POLICY;

    // platform wide fork arbiter
    IEthereumForkArbiter private FORK_ARBITER;

    ////////////////////////
    // Mutable state
    ////////////////////////

    // mapping of known contracts to addresses of singletons
    mapping(bytes4 => address) private _singletons;

    // mapping of known interfaces to collections of contracts
    mapping(bytes4 => mapping(address => uint256)) private _collections;


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
        ACCESS_POLICY = accessPolicy;
        FORK_ARBITER = forkArbiter;
    }

    ////////////////////////
    // Public methods
    ////////////////////////

    // TODO: implement registry settings

    ////////////////////////
    // Getters
    ////////////////////////

    function accessPolicy() public constant returns (IAccessPolicy) {
        return ACCESS_POLICY;
    }

    function forkArbiter() public constant returns (IEthereumForkArbiter) {
        return FORK_ARBITER;
    }

    function neumark() public constant returns (Neumark) {
        // TODO: must be more lightweight
        return Neumark(_singletons[bytes4(keccak256("NEUMARK"))]);
    }

    function etherToken() public constant returns (EtherToken) {
        return EtherToken(_singletons[bytes4(keccak256("ETHER_TOKEN"))]);
    }

    function euroToken() public constant returns (EuroToken) {
        return EuroToken(_singletons[bytes4(keccak256("EURO_TOKEN"))]);
    }

    function etherLock() public constant returns (LockedAccount) {
        return LockedAccount(_singletons[bytes4(keccak256("ETHER_LOCK"))]);
    }

    function euroLock() public constant returns (LockedAccount) {
        return LockedAccount(_singletons[bytes4(keccak256("EURO_LOCK"))]);
    }

    function identityRegistry() public constant returns (IIdentityRegistry) {
        return IIdentityRegistry(_singletons[bytes4(keccak256("IDENTITY_REGISTRY"))]);
    }

    function currencyRateOracle() public constant returns (ICurrencyRateOracle) {
        return ICurrencyRateOracle(_singletons[bytes4(keccak256("CURRENCY_RATES"))]);
    }

    function feeDisbursal() public constant returns (IFeeDisbursal) {
        return IFeeDisbursal(_singletons[bytes4(keccak256("FEE_DISBURSAL"))]);
    }
}
