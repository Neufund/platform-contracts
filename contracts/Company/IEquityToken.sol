pragma solidity 0.4.15;

import '../Standards/IERC677Token.sol';
import '../Standards/IERC223Token.sol';
import '../Standards/ITokenSnapshots.sol';


contract IEquityToken is
        IERC677Token,
        IERC223Token,
        ITokenSnapshots
{

}
