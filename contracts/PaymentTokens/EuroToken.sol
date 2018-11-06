pragma solidity 0.4.25;

import "../AccessControl/AccessControlled.sol";
import "../Agreement.sol";
import "../SnapshotToken/Helpers/TokenMetadata.sol";
import "../Zeppelin/StandardToken.sol";
import "../Standards/IWithdrawableToken.sol";
import "../Standards/IERC223Token.sol";
import "../Standards/IERC223Callback.sol";
import "../Standards/IContractId.sol";
import "../IsContract.sol";
import "../AccessRoles.sol";
import "../Standards/ITokenControllerHook.sol";
import "../Standards/ITokenController.sol";


contract EuroToken is
    Agreement,
    IERC677Token,
    StandardToken,
    IWithdrawableToken,
    ITokenControllerHook,
    TokenMetadata,
    IERC223Token,
    IsContract,
    IContractId
{
    ////////////////////////
    // Constants
    ////////////////////////

    string private constant NAME = "Euro Token";

    string private constant SYMBOL = "EUR-T";

    uint8 private constant DECIMALS = 18;

    ////////////////////////
    // Mutable state
    ////////////////////////

    ITokenController private _tokenController;

    ////////////////////////
    // Events
    ////////////////////////

    /// on each deposit (increase of supply) of EUR-T
    /// 'by' indicates account that executed the deposit function for 'to' (typically bank connector)
    event LogDeposit(
        address indexed to,
        address by,
        uint256 amount,
        bytes32 reference
    );

    // proof of requested deposit initiated by token holder
    event LogWithdrawal(
        address indexed from,
        uint256 amount
    );

    // proof of settled deposit
    event LogWithdrawSettled(
        address from,
        address by, // who settled
        uint256 amount, // settled amount, after fees, negative interest rates etc.
        uint256 originalAmount, // original amount withdrawn
        bytes32 withdrawTxHash, // hash of withdraw transaction
        bytes32 reference // reference number of withdraw operation at deposit manager
    );

    /// on destroying the tokens without withdraw (see `destroyTokens` function below)
    event LogDestroy(
        address indexed from,
        address by,
        uint256 amount
    );

    ////////////////////////
    // Modifiers
    ////////////////////////

    modifier onlyIfDepositAllowed(address to, uint256 amount) {
        require(_tokenController.onGenerateTokens(msg.sender, to, amount));
        _;
    }

    modifier onlyIfWithdrawAllowed(address from, uint256 amount) {
        require(_tokenController.onDestroyTokens(msg.sender, from, amount));
        _;
    }

    ////////////////////////
    // Constructor
    ////////////////////////

    constructor(
        IAccessPolicy accessPolicy,
        IEthereumForkArbiter forkArbiter,
        ITokenController tokenController
    )
        Agreement(accessPolicy, forkArbiter)
        StandardToken()
        TokenMetadata(NAME, DECIMALS, SYMBOL, "")
        public
    {
        require(tokenController != ITokenController(0x0));
        _tokenController = tokenController;
    }

    ////////////////////////
    // Public functions
    ////////////////////////

    /// @notice deposit 'amount' of EUR-T to address 'to', attaching correlating `reference` to LogDeposit event
    /// @dev deposit may happen only in case 'to' can receive transfer in token controller
    ///     by default KYC is required to receive deposits
    function deposit(address to, uint256 amount, bytes32 reference)
        public
        only(ROLE_EURT_DEPOSIT_MANAGER)
        onlyIfDepositAllowed(to, amount)
        acceptAgreement(to)
    {
        require(to != address(0));
        _balances[to] = add(_balances[to], amount);
        _totalSupply = add(_totalSupply, amount);
        emit LogDeposit(to, msg.sender, amount, reference);
        emit Transfer(address(0), to, amount);
    }

    /// @notice runs many deposits within one transaction
    /// @dev deposit may happen only in case 'to' can receive transfer in token controller
    ///     by default KYC is required to receive deposits
    function depositMany(address[] to, uint256[] amount, bytes32[] reference)
        public
    {
        require(to.length == amount.length);
        require(to.length == reference.length);
        for (uint256 i = 0; i < to.length; i++) {
            deposit(to[i], amount[i], reference[i]);
        }
    }

    /// @notice withdraws 'amount' of EUR-T by burning required amount and providing a proof of whithdrawal
    /// @dev proof is provided in form of log entry. based on that proof deposit manager will make a bank transfer
    ///     by default controller will check the following: KYC and existence of working bank account
    function withdraw(uint256 amount)
        public
        onlyIfWithdrawAllowed(msg.sender, amount)
        acceptAgreement(msg.sender)
    {
        destroyTokensPrivate(msg.sender, amount);
        emit LogWithdrawal(msg.sender, amount);
    }

    /// @notice issued by deposit manager when withdraw request was settled. typicaly amount that could be settled will be lower
    ///         than amount withdrawn: banks charge negative interest rates and various fees that must be deduced
    ///         reference number is attached that may be used to identify withdraw operation at deposit manager
    function settleWithdraw(address from, uint256 amount, uint256 originalAmount, bytes32 withdrawTxHash, bytes32 reference)
        public
        only(ROLE_EURT_DEPOSIT_MANAGER)
    {
        emit LogWithdrawSettled(from, msg.sender, amount, originalAmount, withdrawTxHash, reference);
    }

    /// @notice this method allows to destroy EUR-T belonging to any account
    ///     note that EURO is fiat currency and is not trustless, EUR-T is also
    ///     just internal currency of Neufund platform, not general purpose stable coin
    ///     we need to be able to destroy EUR-T if ordered by authorities
    function destroy(address owner, uint256 amount)
        public
        only(ROLE_EURT_LEGAL_MANAGER)
    {
        destroyTokensPrivate(owner, amount);
        emit LogDestroy(owner, msg.sender, amount);
    }

    //
    // Implements ITokenControllerHook
    //

    function changeTokenController(address newController)
        public
        only(ROLE_EURT_LEGAL_MANAGER)
    {
        require(_tokenController.onChangeTokenController(msg.sender, newController));
        _tokenController = ITokenController(newController);
        emit LogChangeTokenController(_tokenController, newController, msg.sender);
    }

    function tokenController()
        public
        constant
        returns (address)
    {
        return _tokenController;
    }

    //
    // Implements IERC223Token
    //
    function transfer(address to, uint256 amount, bytes data)
        public
        returns (bool success)
    {
        return ierc223TransferInternal(msg.sender, to, amount, data);
    }

    /// @notice convenience function to deposit and immediately transfer amount
    /// @param depositTo which account to deposit to and then transfer from
    /// @param transferTo where to transfer after deposit
    /// @param depositAmount amount to deposit
    /// @param transferAmount total amount to transfer, must be <= balance after deposit
    /// @dev intended to deposit from bank account and invest in ETO
    function depositAndTransfer(
        address depositTo,
        address transferTo,
        uint256 depositAmount,
        uint256 transferAmount,
        bytes data,
        bytes32 reference
    )
        public
        returns (bool success)
    {
        deposit(depositTo, depositAmount, reference);
        return ierc223TransferInternal(depositTo, transferTo, transferAmount, data);
    }

    //
    // Implements IContractId
    //

    function contractId() public pure returns (bytes32 id, uint256 version) {
        return (0xfb5c7e43558c4f3f5a2d87885881c9b10ff4be37e3308579c178bf4eaa2c29cd, 0);
    }

    ////////////////////////
    // Internal functions
    ////////////////////////

    //
    // Implements MTokenController
    //

    function mOnTransfer(
        address from,
        address to,
        uint256 amount
    )
        internal
        acceptAgreement(from)
        returns (bool allow)
    {
        address broker = msg.sender;
        if (broker != from) {
            // if called by the depositor (deposit and send), ignore the broker flag
            bool isDepositor = accessPolicy().allowed(msg.sender, ROLE_EURT_DEPOSIT_MANAGER, this, msg.sig);
            // this is not very clean but alternative (give brokerage rights to all depositors) is maintenance hell
            if (isDepositor) {
                broker = from;
            }
        }
        return _tokenController.onTransfer(broker, from, to, amount);
    }

    function mOnApprove(
        address owner,
        address spender,
        uint256 amount
    )
        internal
        acceptAgreement(owner)
        returns (bool allow)
    {
        return _tokenController.onApprove(owner, spender, amount);
    }

    function mAllowanceOverride(
        address owner,
        address spender
    )
        internal
        constant
        returns (uint256)
    {
        return _tokenController.onAllowance(owner, spender);
    }

    //
    // Observes MAgreement internal interface
    //

    /// @notice euro token is legally represented by separate entity ROLE_EURT_LEGAL_MANAGER
    function mCanAmend(address legalRepresentative)
        internal
        returns (bool)
    {
        return accessPolicy().allowed(legalRepresentative, ROLE_EURT_LEGAL_MANAGER, this, msg.sig);
    }

    ////////////////////////
    // Private functions
    ////////////////////////

    function destroyTokensPrivate(address owner, uint256 amount)
        private
    {
        require(_balances[owner] >= amount);
        _balances[owner] = sub(_balances[owner], amount);
        _totalSupply = sub(_totalSupply, amount);
        emit Transfer(owner, address(0), amount);
    }

    /// @notice internal transfer function that checks permissions and calls the tokenFallback
    function ierc223TransferInternal(address from, address to, uint256 amount, bytes data)
        private
        returns (bool success)
    {
        BasicToken.mTransfer(from, to, amount);

        // Notify the receiving contract.
        if (isContract(to)) {
            // in case of re-entry (1) transfer is done (2) msg.sender is different
            IERC223Callback(to).tokenFallback(from, amount, data);
        }
        return true;
    }
}
