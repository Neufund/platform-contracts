pragma solidity 0.4.26;

import "../Neumark.sol";
import "../Standards/IWithdrawableToken.sol";


contract TestNeumark is
    Neumark,
    IWithdrawableToken
{

    ////////////////////////
    // Constructor
    ////////////////////////

    constructor(
        IAccessPolicy accessPolicy,
        IEthereumForkArbiter forkArbiter
    )
        Neumark(accessPolicy, forkArbiter)
        public
    {
    }

    ////////////////////////
    // Public functions
    ////////////////////////

    function deposit(uint256 neumarkUlps)
        public
    {
        mGenerateTokens(msg.sender, neumarkUlps);
    }

    function withdraw(uint256 amount)
        public
    {
        mDestroyTokens(msg.sender, amount);
    }
}
