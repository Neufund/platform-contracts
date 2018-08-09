pragma solidity 0.4.24;

import "../AccessControl/AccessControlled.sol";
import "../Reclaimable.sol";
import "../IsContract.sol";
import "../Standards/IERC223Token.sol";
import "../Standards/IERC223Callback.sol";
import "../SnapshotToken/Helpers/TokenMetadata.sol";
import "../Zeppelin/StandardToken.sol";


contract EtherToken is
    IsContract,
    AccessControlled,
    StandardToken,
    TokenMetadata,
    IERC223Token,
    Reclaimable
{
    ////////////////////////
    // Constants
    ////////////////////////

    string private constant NAME = "Ether Token";

    string private constant SYMBOL = "ETH-T";

    uint8 private constant DECIMALS = 18;

    ////////////////////////
    // Events
    ////////////////////////

    event LogDeposit(
        address indexed to,
        uint256 amount
    );

    event LogWithdrawal(
        address indexed from,
        uint256 amount
    );

    event LogWithdrawAndSend(
        address indexed from,
        address indexed to,
        uint256 amount
    );

    ////////////////////////
    // Constructor
    ////////////////////////

    constructor(IAccessPolicy accessPolicy)
        AccessControlled(accessPolicy)
        StandardToken()
        TokenMetadata(NAME, DECIMALS, SYMBOL, "")
        Reclaimable()
        public
    {
    }

    ////////////////////////
    // Public functions
    ////////////////////////

    /// deposit msg.value of Ether to msg.sender balance
    function deposit()
        public
        payable
    {
        depositPrivate();
        emit Transfer(address(0), msg.sender, msg.value);
    }

    /// @notice convenience function to deposit and immediately transfer amount
    /// @param transferTo where to transfer after deposit
    /// @param amount total amount to transfer, must be <= balance after deposit
    /// @param data erc223 data
    /// @dev intended to deposit from simple account and invest in ETO
    function depositAndTransfer(address transferTo, uint256 amount, bytes data)
        public
        payable
    {
        depositPrivate();
        transfer(transferTo, amount, data);
    }

    /// withdraws and sends 'amount' of ether to msg.sender
    function withdraw(uint256 amount)
        public
    {
        withdrawPrivate(amount);
        msg.sender.transfer(amount);
    }

    /// @notice convenience function to withdraw and transfer to external account
    /// @param sendTo address to which send total amount
    /// @param amount total amount to withdraw and send
    /// @dev function is payable and is meant to withdraw funds on accounts balance and token in single transaction
    /// @dev BEWARE that msg.sender of the funds is Ether Token contract and not simple account calling it.
    /// @dev  when sent to smart conctract funds may be lost, so this is prevented below
    function withdrawAndSend(address sendTo, uint256 amount)
        public
        payable
    {
        // must send at least what is in msg.value to being another deposit function
        require(amount >= msg.value);
        // must send to simple address
        require(!isContract(sendTo));
        if (amount > msg.value) {
            uint256 withdrawRemainder = amount - msg.value;
            withdrawPrivate(withdrawRemainder);
        }
        emit LogWithdrawAndSend(msg.sender, sendTo, amount);
        sendTo.transfer(amount);
    }

    //
    // Implements IERC223Token
    //

    function transfer(address to, uint256 amount, bytes data)
        public
        returns (bool)
    {
        transferInternal(msg.sender, to, amount);

        // Notify the receiving contract.
        if (isContract(to)) {
            // in case of re-entry (1) transfer is done (2) msg.sender is different
            IERC223Callback(to).tokenFallback(msg.sender, amount, data);
        }
        return true;
    }

    //
    // Overrides Reclaimable
    //

    /// @notice allows EtherToken to reclaim tokens wrongly sent to its address
    /// @dev as EtherToken by design has balance of Ether (native Ethereum token)
    ///     such reclamation is not allowed
    function reclaim(IBasicToken token)
        public
    {
        // forbid reclaiming ETH hold in this contract.
        require(token != RECLAIM_ETHER);
        Reclaimable.reclaim(token);
    }

    ////////////////////////
    // Private functions
    ////////////////////////

    function depositPrivate()
        private
    {
        _balances[msg.sender] = add(_balances[msg.sender], msg.value);
        _totalSupply = add(_totalSupply, msg.value);
        emit LogDeposit(msg.sender, msg.value);
    }

    function withdrawPrivate(uint256 amount)
        private
    {
        require(_balances[msg.sender] >= amount);
        _balances[msg.sender] = sub(_balances[msg.sender], amount);
        _totalSupply = sub(_totalSupply, amount);
        emit LogWithdrawal(msg.sender, amount);
        emit Transfer(msg.sender, address(0), amount);
    }
}
