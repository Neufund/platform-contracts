pragma solidity 0.4.25;


import "../Standards/IERC20Token.sol";
import "../Standards/IERC677Token.sol";
import "../Standards/IERC677Callback.sol";
import "./BasicToken.sol";
import "../SnapshotToken/Helpers/TokenAllowance.sol";


/**
 * @title Standard ERC20 token
 *
 * @dev Implementation of the standard token.
 * @dev https://github.com/ethereum/EIPs/issues/20
 */
contract StandardToken is
    IERC20Token,
    BasicToken,
    TokenAllowance
{

}
