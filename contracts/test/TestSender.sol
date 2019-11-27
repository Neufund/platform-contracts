pragma solidity 0.4.26;

/** Contract that will send all its ether to a given address, reverts upon failure */
contract TestSender {
    function sendAllEther(address to) public {
        to.transfer(address(this).balance);
    }

    // fallback function to receive ether
    function () external payable {}
}
