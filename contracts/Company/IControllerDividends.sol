pragma solidity 0.4.26;

import "../Standards/IERC223Token.sol";
import "../Standards/IERC223Callback.sol";


/// @title interface of governance module providing payouts from payment tokens against pro rata token
/// @dev actual payout happens via ERC223 transfer and IERC223Callback implementation
contract IControllerDividends is IERC223Callback {

    ////////////////////////
    // Governance Module Id
    ////////////////////////

    bytes32 internal constant ControllerDividendsId = 0x6f34e3bc451d7c62ae86b2e212b7cb207815b826f8de016c0128b0d3762753ae;
    uint256 internal constant ControllerDividendsV = 0;

    ////////////////////////
    // Interface Methods
    ////////////////////////

    // declare amount of paymentToken to be paid against governance token, does not need shareholder resolution
    // resolution is completed via ERC223 transfer of required amount
    function ordinaryPayoutResolution(
        bytes32 resolutionId,
        IERC223Token paymentToken,
        uint256 amount,
        uint256 recycleAfter,
        string resolutionDocumentUrl
    )
        public;

    // declare amount of paymentToken to be paid against governance token, requires shareholder resolution
    // resolution is completed via ERC223 transfer of required amount
    function extraOrdinaryPayoutResolution(
        bytes32 resolutionId,
        IERC223Token paymentToken,
        uint256 amount,
        uint256 recycleAfter,
        string resolutionDocumentUrl
    )
        public;
}
