pragma solidity 0.4.24;

import "../Standards/ITokenController.sol";
import "../AccessControl/AccessControlled.sol";
import "../AccessRoles.sol";
import "../KnownInterfaces.sol";
import "../Universe.sol";
import "../Identity/IIdentityRegistry.sol";


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
    // Constants
    ////////////////////////

    bytes4[] private TRANSFER_ALLOWED_INTERFACES = [KNOWN_INTERFACE_COMMITMENT, KNOWN_INTERFACE_EQUITY_TOKEN_CONTROLLER];

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

    // identity registry
    IIdentityRegistry private _identityRegistry;

    ////////////////////////
    // Constructor
    ////////////////////////

    constructor(
        Universe universe
    )
        AccessControlled(universe.accessPolicy())
        public
    {
        UNIVERSE = universe;
    }

    ////////////////////////
    // Public Functions
    ////////////////////////

    /// @notice enables or disables address to be receipient of EUR-T
    function setAllowedTransferTo(address to, bool allowed)
        public
        only(ROLE_EURT_LEGAL_MANAGER)
    {
        setAllowedTransferToPrivate(to, allowed);
    }

    /// @notice enables or disables address to be sender of EUR-T
    function setAllowedTransferFrom(address from, bool allowed)
        public
        only(ROLE_EURT_LEGAL_MANAGER)
    {
        setAllowedTransferFromPrivate(from, allowed);
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
        applySettingsPrivate(
            minDepositAmountEurUlps,
            minWithdrawAmountEurUlps,
            maxSimpleExchangeAllowanceEurUlps
        );
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
        return isTransferAllowedPrivate(from, to, false);
    }

    function onTransferFrom(address broker, address from, address to, uint256 /*amount*/)
        public
        constant
        returns (bool allow)
    {
        return isTransferAllowedPrivate(from, to, true) && _allowedTransferFrom[broker];
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
        address exchange = UNIVERSE.gasExchange();
        return spender == address(exchange) && amount <= _maxSimpleExchangeAllowanceEurUlps;
    }

    /// allows to deposit if user has kyc and deposit is >= minimum
    function onGenerateTokens(address /*sender*/, address owner, uint256 amount)
        public
        constant
        returns (bool allow)
    {
        if (amount < _minDepositAmountEurUlps) {
            return false;
        }
        if(_allowedTransferTo[owner]) {
            return true;
        }
        IdentityClaims memory claims = deserializeClaims(_identityRegistry.getClaims(owner));
        return claims.isVerified && !claims.accountFrozen;
    }

    /// allow to withdraw if user has a valid bank account, kyc and amount >= minium
    function onDestroyTokens(address /*sender*/, address owner, uint256 amount)
        public
        constant
        returns (bool allow)
    {
        if (amount < _minWithdrawAmountEurUlps) {
            return false;
        }
        if(_allowedTransferFrom[owner]) {
            return true;
        }
        IdentityClaims memory claims = deserializeClaims(_identityRegistry.getClaims(owner));
        return claims.isVerified && !claims.accountFrozen && claims.hasBankAccount;
    }

    ////////////////////////
    // Private Functions
    ////////////////////////

    function applySettingsPrivate(
        uint256 pMinDepositAmountEurUlps,
        uint256 pMinWithdrawAmountEurUlps,
        uint256 pMaxSimpleExchangeAllowanceEurUlps
    )
        private
    {
        _identityRegistry = IIdentityRegistry(UNIVERSE.identityRegistry());
        allowFromUniverse();
        _minDepositAmountEurUlps = pMinDepositAmountEurUlps;
        _minWithdrawAmountEurUlps = pMinWithdrawAmountEurUlps;
        _maxSimpleExchangeAllowanceEurUlps = pMaxSimpleExchangeAllowanceEurUlps;
    }

    /// enables to and from transfers for several Universe singletons
    function allowFromUniverse()
        private
    {
        // contracts below may send funds
        // euro lock must be able to send (invest)
        setAllowedTransferFromPrivate(UNIVERSE.euroLock(), true);
        // fee disbursal must be able to pay out
        setAllowedTransferFromPrivate(UNIVERSE.feeDisbursal(), true);
        // gas exchange must be able to act as a broker (from)
        setAllowedTransferFromPrivate(UNIVERSE.gasExchange(), true);

        // contracts below may receive funds
        // fee disbursal may receive funds to disburse
        setAllowedTransferToPrivate(UNIVERSE.feeDisbursal(), true);
        // euro lock may receive refunds
        setAllowedTransferToPrivate(UNIVERSE.euroLock(), true);
        // gas exchange must be able to receive euro token (as payment)
        setAllowedTransferToPrivate(UNIVERSE.gasExchange(), true);

        emit LogUniverseReloaded();
    }

    function setAllowedTransferToPrivate(address to, bool allowed)
        private
    {
        _allowedTransferTo[to] = allowed;
        emit LogAllowedToAddress(to, allowed);
    }

    function setAllowedTransferFromPrivate(address from, bool allowed)
        private
    {
        _allowedTransferFrom[from] = allowed;
        emit LogAllowedFromAddress(from, allowed);
    }

    // optionally allows peer to peer transfers of Verified users: for the transferFrom check
    function isTransferAllowedPrivate(address from, address to, bool allowPeerTransfers)
        private
        constant
        returns (bool)
    {
        // check if both parties are explicitely allowed for transfers
        bool explicitFrom = _allowedTransferFrom[from];
        bool explicitTo = _allowedTransferTo[to];
        if (explicitFrom && explicitTo) {
            return true;
        }
        // try to resolve 'from'
        if (!explicitFrom) {
            IdentityClaims memory claimsFrom = deserializeClaims(_identityRegistry.getClaims(from));
            explicitFrom = claimsFrom.isVerified && !claimsFrom.accountFrozen;
        }
        if (!explicitFrom) {
            // all ETO and ETC contracts may send funds (for example: refund)
            explicitFrom = UNIVERSE.isAnyOfInterfaceCollectionInstance(TRANSFER_ALLOWED_INTERFACES, from);
        }
        if (!explicitFrom) {
            // from will not be resolved, return immediately
            return false;
        }
        if (!explicitTo) {
            // all ETO and ETC contracts may receive funds
            explicitTo = UNIVERSE.isAnyOfInterfaceCollectionInstance(TRANSFER_ALLOWED_INTERFACES, to);
        }
        if (!explicitTo) {
            // if not, `to` address must have kyc (all addresses with KYC may receive transfers)
            IdentityClaims memory claims = deserializeClaims(_identityRegistry.getClaims(to));
            explicitTo = claims.isVerified && !claims.accountFrozen;
        }
        if (allowPeerTransfers) {
            return explicitTo;
        }
        if(claims.isVerified && !claims.accountFrozen && claimsFrom.isVerified && !claimsFrom.accountFrozen) {
            // user to user transfer not allowed
            return false;
        }
        // we only get here if explicitFrom was true
        return explicitTo;
    }
}
