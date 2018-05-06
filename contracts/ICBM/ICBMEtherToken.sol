pragma solidity 0.4.23;

import "../AccessControl/AccessControlled.sol";
import "../Reclaimable.sol";
import "../IsContract.sol";
import "../Standards/IERC223Token.sol";
import "../Standards/IERC223LegacyCallback.sol";
import "../SnapshotToken/Helpers/TokenMetadata.sol";
import "../Zeppelin/StandardToken.sol";


contract ICBMEtherToken is
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

    ////////////////////////
    // Constructor
    ////////////////////////

    function ICBMEtherToken(IAccessPolicy accessPolicy)
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
        payable
        public
    {
        _balances[msg.sender] = add(_balances[msg.sender], msg.value);
        _totalSupply = add(_totalSupply, msg.value);
        emit LogDeposit(msg.sender, msg.value);
        emit Transfer(address(0), msg.sender, msg.value);
    }

    /// withdraws and sends 'amount' of ether to msg.sender
    function withdraw(uint256 amount)
        public
    {
        require(_balances[msg.sender] >= amount);
        _balances[msg.sender] = sub(_balances[msg.sender], amount);
        _totalSupply = sub(_totalSupply, amount);
        msg.sender.transfer(amount);
        emit LogWithdrawal(msg.sender, amount);
        emit Transfer(msg.sender, address(0), amount);
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
            IERC223LegacyCallback(to).onTokenTransfer(msg.sender, amount, data);
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
}
