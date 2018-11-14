pragma solidity 0.4.25;

import "./IERC223Callback.sol";


/// @title disburse payment token amount to snapshot token holders
/// @dev payment token received via ERC223 Transfer
contract IFeeDisbursal is IERC223Callback {
    // TODO: declare interface
    function claim() public;

    function recycle() public;
}
