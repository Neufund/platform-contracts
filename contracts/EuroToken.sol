pragma solidity 0.4.15;

import "./Standards/IERC223Token.sol";
import "./ICBM/ICBMEuroToken.sol";


contract EuroToken is
    ICBMEuroToken,
    IERC223Token
{

}
