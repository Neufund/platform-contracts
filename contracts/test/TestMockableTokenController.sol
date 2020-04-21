pragma solidity 0.4.26;

import "../Universe.sol";
import "../Agreement.sol";
import "../Company/IEquityTokenController.sol";
import "./TestTokenControllerPassThrough.sol";


contract TestMockableTokenController is
    TestTokenControllerPassThrough
{

    ////////////////////////
    // Mutable state
    ////////////////////////

    bool internal _allowOnTransfer;
    bool internal _allowOnApprove;
    bool internal _allowDestroyTokens;
    bool internal _allowGenerateTokens;
    bool internal _allowChangeTokenController;

    mapping (address => mapping (address => uint256)) internal _overrides;

    // enable to address to operate on specific amount, address could be broker, to, form, owner, spender, see below.
    mapping (address => uint256) internal _enabledAddresses;

    // swap owner and sender in generate/destroy as token sends same value and not all cases could be tested
    bool internal _swapOwnerSender;

    ////////////////////////
    // Constructor
    ////////////////////////

    constructor()
        public
    {
        _allowOnTransfer = true;
        _allowOnApprove = true;
        _allowDestroyTokens = true;
        _allowGenerateTokens = true;
        _allowChangeTokenController = true;
    }

    ////////////////////////
    // Public Methods
    ////////////////////////


    //
    //  Implements ITokenController
    //

    function onTransfer(address broker, address from, address to, uint256 amount)
        public
        constant
        returns (bool)
    {
        return _allowOnTransfer || _enabledAddresses[broker] == amount || _enabledAddresses[from] == amount || _enabledAddresses[to] == amount;
    }

    function onApprove(address owner, address spender, uint256 amount)
        public
        constant
        returns (bool)
    {
        return _allowOnApprove || _enabledAddresses[owner] == amount || _enabledAddresses[spender] == amount;
    }

    function onAllowance(address owner, address spender)
        public
        constant
        returns (uint256)
    {
        return _overrides[owner][spender];
    }

    function onGenerateTokens(address sender, address owner, uint256 amount)
        public
        constant
        returns (bool)
    {
        if (_swapOwnerSender) {
            return _allowGenerateTokens || _enabledAddresses[sender] == amount;
        } else {
            return _allowGenerateTokens || _enabledAddresses[owner] == amount;
        }
    }

    function onDestroyTokens(address sender, address owner, uint256 amount)
        public
        constant
        returns (bool)
    {
        if (_swapOwnerSender) {
            return _allowDestroyTokens || _enabledAddresses[sender] == amount;
        } else {
            return _allowDestroyTokens || _enabledAddresses[owner] == amount;
        }
    }

    function onChangeTokenController(address sender, address newController)
        public
        constant
        returns (bool)
    {
        return _allowChangeTokenController || _enabledAddresses[sender] == 1 || _enabledAddresses[newController] == 1;
    }

    //
    //  Mock functions
    //

    function setAllowOnTransfer(bool allow)
        public
    {
        _allowOnTransfer = allow;
    }

    function setAllowApprove(bool allow)
        public
    {
        _allowOnApprove = allow;
    }

    function setAllowOnGenerateTokens(bool allow)
        public
    {
        _allowGenerateTokens = allow;
    }

    function setAllowDestroyTokens(bool allow)
        public
    {
        _allowDestroyTokens = allow;
    }

    function setAllowChangeTokenController(bool allow)
        public
    {
        _allowChangeTokenController = allow;
    }

    // this is really nasty controller that can force any transfer it wants
    function setAllowanceOverride(address owner, address controller, uint256 amount)
        public
    {
        _overrides[owner][controller] = amount;
    }

    function setAllowedAddress(address a, uint256 amount)
        public
    {
        _enabledAddresses[a] = amount;
    }

    function swapOwnerSender(bool senderFirst)
        public
    {
        _swapOwnerSender = senderFirst;
    }
}
