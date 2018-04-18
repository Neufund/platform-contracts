pragma solidity 0.4.15;


/// @title known interfaces of the platform
/// @dev constants are kept in CODE not in STORAGE so they are comparatively cheap
contract KnownInterfaces {

    ////////////////////////
    // Constants
    ////////////////////////

    // NOTE: All interface are set to the keccak256 hash of the
    // CamelCased interface or singleton name, i.e.
    // KNOWN_INTERFACE_NEUMARK = keccak256("Neumark")

    // EIP 165 + EIP 820 should be use instead but it seems they are far from finished
    // also interface signature should be build automatically by solidity. otherwise it is a pure hassle

    // neumark token interface and sigleton keccak256("Neumark")
    bytes4 internal constant KNOWN_INTERFACE_NEUMARK = 0xeb41a1bd;

    // ether token interface and singleton keccak256("EtherToken")
    bytes4 internal constant KNOWN_INTERFACE_ETHER_TOKEN = 0x8cf73cf1;

    // euro token interface and singleton keccak256("EuroToken")
    bytes4 internal constant KNOWN_INTERFACE_EURO_TOKEN = 0x83c3790b;

    // identity registry interface and singleton keccak256("IIdentityRegistry")
    bytes4 internal constant KNOWN_INTERFACE_IDENTITY_REGISTRY = 0x0a72e073;

    // currency rates oracle interface and singleton keccak256("ITokenExchangeRateOracle")
    bytes4 internal constant KNOWN_INTERFACE_TOKEN_EXCHANGE_RATE_ORACLE = 0xc6e5349e;

    // fee disbursal interface and singleton keccak256("IFeeDisbursal")
    bytes4 internal constant KNOWN_INTERFACE_FEE_DISBURSAL = 0xf4c848e8;

    // token exchange interface and singleton keccak256("ITokenExchange")
    bytes4 internal constant KNOWN_INTERFACE_TOKEN_EXCHANGE = 0xddd7a521;

    // service exchanging euro token for gas ("IGasTokenExchange")
    bytes4 internal constant KNOWN_INTERFACE_GAS_EXCHANGE = 0x89dbc6de;

    // access policy interface and singleton keccak256("IAccessPolicy")
    bytes4 internal constant KNOWN_INTERFACE_ACCESS_POLICY = 0xb05049d9;

    // euro lock account (upgraded) keccak256("LockedAccount:Euro")
    bytes4 internal constant KNOWN_INTERFACE_EURO_LOCK = 0x2347a19e;

    // ether lock account (upgraded) keccak256("LockedAccount:Ether")
    bytes4 internal constant KNOWN_INTERFACE_ETHER_LOCK = 0x978a6823;

    // icbm euro lock account keccak256("ICBMLockedAccount:Euro")
    bytes4 internal constant KNOWN_INTERFACE_ICBM_EURO_LOCK = 0x36021e14;

    // ether lock account (upgraded) keccak256("ICBMLockedAccount:Ether")
    bytes4 internal constant KNOWN_INTERFACE_ICBM_ETHER_LOCK = 0x0b58f006;

    // ether token interface and singleton keccak256("ICBMEtherToken")
    bytes4 internal constant KNOWN_INTERFACE_ICBM_ETHER_TOKEN = 0xae8b50b9;

    // euro token interface and singleton keccak256("ICBMEuroToken")
    bytes4 internal constant KNOWN_INTERFACE_ICBM_EURO_TOKEN = 0xc2c6cd72;

    // ETO commitment interface interface and singleton keccak256("ICBMCommitment")
    bytes4 internal constant KNOWN_INTERFACE_ICBM_COMMITMENT = 0x7f2795ef;

    // ethereum fork arbiter interface and singleton keccak256("IEthereumForkArbiter")
    bytes4 internal constant KNOWN_INTERFACE_FORK_ARBITER = 0x2fe7778c;

    // ETO commitment interface interface and singleton keccak256("ICommitment")
    bytes4 internal constant KNOWN_INTERFACE_COMMITMENT = 0xfa0e0c60;
}
