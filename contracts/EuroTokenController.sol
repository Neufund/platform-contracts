pragma solidity 0.4.15;

import "./Standards/ITokenController.sol";
import './AccessControl/AccessControlled.sol';
import './AccessRoles.sol';
import './KnownInterfaces.sol';
import './Universe.sol';
import "./Identity/IIdentityRegistry.sol";


/// @title token controller for EuroToken
/// @notice permissions for transfer are divided in 'from' permission (address sends funds)
///  and 'to' permission (address receives funds). both transfer sides must have appropriate permission for transfer to happen
///  also controls for minimum amounts in deposit and withdraw permissions
///  whitelist several known singleton contracts from Universe to be able to receive and send EUR-T
/// @dev if contracts are replaced in universe, `applySettings` function must be called
contract EuroTokenController is
    ITokenController,
    AccessControlled,
    AccessRoles,
    IdentityRecord,
    KnownInterfaces
{

    ////////////////////////
    // Events
    ////////////////////////

    event LogAllowedFromAddress(
        address indexed from,
        bool allowed
    );

    event LogAllowedToAddress(
        address indexed to,
        bool allowed
    );

    event LogUniverseReloaded();

    ////////////////////////
    // Immutable state
    ////////////////////////

    Universe private UNIVERSE;

    ////////////////////////
    // Mutable state
    ////////////////////////

    // a list of addresses that are allowed to receive EUR-T
    mapping(address => bool) private _allowedTransferTo;

    // a list of of addresses that are allowed to send EUR-T
    mapping(address => bool) private _allowedTransferFrom;

    // min deposit amount
    uint256 private _minDepositAmountEurUlps;

    // min withdraw amount
    uint256 private _minWithdrawAmountEurUlps;

    // max token exchange can make for gas purchase
    uint256 private _maxSimpleExchangeAllowanceEurUlps;

    ////////////////////////
    // Constructor
    ////////////////////////

    function EuroTokenController(
        Universe universe,
        uint256 minDepositAmountEurUlps,
        uint256 minWithdrawAmountEurUlps,
        uint256 maxSimpleExchangeAllowanceEurUlps
    )
        AccessControlled(universe.accessPolicy())
        public
    {
        UNIVERSE = universe;
        applySettings(
            minDepositAmountEurUlps,
            minWithdrawAmountEurUlps,
            maxSimpleExchangeAllowanceEurUlps
        );
    }


    ////////////////////////
    // Public Functions
    ////////////////////////

    /// @notice enables or disables address to be receipient of EUR-T
    function setAllowedTransferTo(address to, bool allowed)
        public
        only(ROLE_EURT_LEGAL_MANAGER)
    {
        _allowedTransferTo[to] = allowed;
        LogAllowedToAddress(to, allowed);
    }

    /// @notice enables or disables address to be sender of EUR-T
    function setAllowedTransferFrom(address from, bool allowed)
        public
        only(ROLE_EURT_LEGAL_MANAGER)
    {
        _allowedTransferFrom[from] = allowed;
        LogAllowedFromAddress(from, allowed);
    }

    /// @notice sets limits and whitelists contracts from universe
    function applySettings(
        uint256 minDepositAmountEurUlps,
        uint256 minWithdrawAmountEurUlps,
        uint256 maxSimpleExchangeAllowanceEurUlps
    )
        public
        only(ROLE_EURT_LEGAL_MANAGER)
    {
        allowFromUniverse();
        _minDepositAmountEurUlps = minDepositAmountEurUlps;
        _minWithdrawAmountEurUlps = minWithdrawAmountEurUlps;
        _maxSimpleExchangeAllowanceEurUlps = maxSimpleExchangeAllowanceEurUlps;
    }

    //
    // Public Getters
    //

    function allowedTransferTo(address to)
        public
        constant
        returns (bool)
    {
        return _allowedTransferTo[to];
    }

    function allowedTransferFrom(address from)
        public
        constant
        returns (bool)
    {
        return _allowedTransferFrom[from];
    }

    function minDepositAmountEurUlps()
        public
        constant
        returns (uint256)
    {
        return _minDepositAmountEurUlps;
    }

    function minWithdrawAmountEurUlps()
        public
        constant
        returns (uint256)
    {
        return _minWithdrawAmountEurUlps;
    }

    function maxSimpleExchangeAllowanceEurUlps()
        public
        constant
        returns (uint256)
    {
        return _maxSimpleExchangeAllowanceEurUlps;
    }

    //
    // Implements ITokenController
    //

    /// allow transfer if both parties are explicitely allowed
    /// or when 'form' is ETO|explicit and 'to' has KYC|explicit
    /// or when 'from' is ETO|explicit and 'to' is ETO|explicit
    function onTransfer(address from, address to, uint256)
        public
        constant
        returns (bool allow)
    {
        // check if both parties are explicitely allowed for transfers
        bool explicitFrom = _allowedTransferFrom[from];
        bool explicitTo = _allowedTransferTo[to];
        if (explicitFrom && explicitTo) {
            return true;
        }
        // try to get 'from'
        if (!explicitFrom) {
            // all ETO contracts may send funds (for example: refund)
            explicitFrom = UNIVERSE.isInterfaceCollectionInstance(KNOWN_INTERFACE_ETO_COMMITMENT, from);
        }
        if (!explicitFrom) {
            // from will not be resolved, return immediately
            return false;
        }
        // if not, `to` address must have kyc (all addresses with KYC may receive transfers)
        IdentityClaims memory claims = deserializeClaims(UNIVERSE.identityRegistry().getClaims(to));
        explicitTo = claims.hasKyc;
        if (!explicitTo) {
            // all ETO contracts may receive funds
            explicitTo = UNIVERSE.isInterfaceCollectionInstance(KNOWN_INTERFACE_ETO_COMMITMENT, to);
        }
        // we only get here if explicitFrom was true
        return explicitTo;
    }

    /// always approve
    function onApprove(address, address, uint256)
        public
        constant
        returns (bool allow)
    {
        return true;
    }

    /// simple exchange contract has permanent allowance within amount eur ulps
    function hasPermanentAllowance(address spender, uint256 amount)
        public
        constant
        returns (bool yes)
    {
        address exchange = UNIVERSE.tokenExchange();
        return spender == address(exchange) && amount <= _maxSimpleExchangeAllowanceEurUlps;
    }

    /// allows to deposit if user has kyc and deposit is >= minimum
    function onGenerateTokens(address owner, uint256 amount)
        public
        constant
        returns (bool allow)
    {
        require(amount >= _minDepositAmountEurUlps);
        IdentityClaims memory claims = deserializeClaims(UNIVERSE.identityRegistry().getClaims(owner));
        return claims.hasKyc;
    }

    /// allow to withdraw if user has a valid bank account, kyc and amount >= minium
    function onDestroyTokens(address owner, uint256 amount)
        public
        constant
        returns (bool allow)
    {
        require(amount >= _minWithdrawAmountEurUlps);
        IdentityClaims memory claims = deserializeClaims(UNIVERSE.identityRegistry().getClaims(owner));
        return claims.hasKyc && claims.hasBankAccount;
    }

    ////////////////////////
    // Private Functions
    ////////////////////////

    /// enables to and from transfers for several Universe singletons
    function allowFromUniverse()
        private
    {
        // contracts below may send funds
        setAllowedTransferFrom(UNIVERSE.euroToken(), true);
        setAllowedTransferFrom(UNIVERSE.euroLock(), true);
        setAllowedTransferFrom(UNIVERSE.feeDisbursal(), true);

        // contracts below may receive funds
        setAllowedTransferTo(UNIVERSE.feeDisbursal(), true);
        setAllowedTransferTo(UNIVERSE.tokenExchange(), true);

        LogUniverseReloaded();
    }
}
