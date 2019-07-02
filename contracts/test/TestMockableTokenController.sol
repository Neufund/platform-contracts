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

    function onTransfer(address, address, address, uint256)
        public
        constant
        returns (bool)
    {
        return _allowOnTransfer;
    }

    function onApprove(address, address, uint256)
        public
        constant
        returns (bool)
    {
        return _allowOnApprove;
    }

    function onAllowance(address owner, address spender)
        public
        constant
        returns (uint256)
    {
        return _overrides[owner][spender];
    }

    function onGenerateTokens(address, address, uint256)
        public
        constant
        returns (bool)
    {
        return _allowGenerateTokens;
    }

    function onDestroyTokens(address, address, uint256)
        public
        constant
        returns (bool)
    {
        return _allowDestroyTokens;
    }

    function onChangeTokenController(address, address)
        public
        constant
        returns (bool)
    {
        return _allowChangeTokenController;
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
}
