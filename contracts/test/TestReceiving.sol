pragma solidity 0.4.26;


import "../Standards/IERC223Callback.sol";
import "../Standards/IERC223LegacyCallback.sol";

/** contract to be used in frontend testing for receiving of
 - ether
 - ERC223 tokens
 - tokens with legacy ERC223 tokenFallback (e.g. Neumark.sol)
*/
contract TestReceiving is IERC223Callback, IERC223LegacyCallback {

    ////////////////////////
    // Mutable state
    ////////////////////////
    address private _from;
    uint256 private _amount;
    bytes32 private _dataKeccak;
    bool private _acceptERC223;

    ////////////////////////
    // Constructor
    ////////////////////////
    constructor() public {
        // some "random" hash
        _dataKeccak = keccak256(abi.encodePacked(address(this)));
        _acceptERC223 = true;
    }


    ////////////////////////
    // Public functions
    ////////////////////////
    function setERC223Acceptance(bool acceptERC223) public {
        _acceptERC223 = acceptERC223;
    }


    // convenience function to check the balance of this contract
    function returnBalance() public view returns(uint) {
        return address(this).balance;
    }

    // fallback function to receive ether
    function () external payable {}

    // fallback function to receive ERC223-Tokens
    function tokenFallback(address from, uint256 amount, bytes data)
        public
    {
        require(_acceptERC223, "Token fallback is not enabled");
        _from = from;
        _amount = amount;
        _dataKeccak = keccak256(data);
    }

    // fallback function to support legacy ERC223 Fallback
    function onTokenTransfer(address from, uint256 amount, bytes data)
        public
    {
        require(_acceptERC223, "Legacy token fallback is not enabled.");
        _from = from;
        _amount = amount;
        _dataKeccak = keccak256(data);
    }

    function amount() public constant returns (uint256) {
        return _amount;
    }

    function from() public constant returns (address) {
        return _from;
    }

    function dataKeccak() public constant returns (bytes32) {
        return _dataKeccak;
    }

}
