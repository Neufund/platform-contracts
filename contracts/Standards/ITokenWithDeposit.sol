pragma solidity 0.4.15;

import './IERC20Token.sol';


contract ITokenWithDeposit is IERC20Token {

    ////////////////////////
    // Events
    ////////////////////////

    event LogDeposit(
        address indexed to,
        uint256 amount
    );

    event LogWithdrawal(
        address indexed to,
        uint256 amount
    );

    ////////////////////////
    // Public functions
    ////////////////////////

    function deposit(address to, uint256 amount)
        public
        payable
        returns (bool);

    function withdraw(uint256 amount)
        public;
}