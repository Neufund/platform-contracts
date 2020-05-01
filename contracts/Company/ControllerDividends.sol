pragma solidity 0.4.26;

import "./ControllerGovernanceEngine.sol";

contract ControllerDividends is
    ControllerGovernanceEngine,
    KnownInterfaces
{
    ////////////////////////
    // Governance Module Id
    ////////////////////////

    bytes32 internal constant ControllerDividendsId = 0x6f34e3bc451d7c62ae86b2e212b7cb207815b826f8de016c0128b0d3762753ae;
    uint256 internal constant ControllerDividendsV = 0;

    ////////////////////////
    // Public Methods
    ////////////////////////

    function ordinaryPayoutResolution(
        bytes32 resolutionId,
        IERC223Token /*paymentToken*/,
        uint256 /*amount*/,
        uint256 /*recycleAfter*/,
        string resolutionDocumentUrl
    )
        public
    {
        payoutResolutionPrivate(resolutionId, Gov.Action.OrdinaryPayout, resolutionDocumentUrl);
    }

    function extraOrdinaryPayoutResolution(
        bytes32 resolutionId,
        IERC223Token /*paymentToken*/,
        uint256 /*amount*/,
        uint256 /*recycleAfter*/,
        string resolutionDocumentUrl
    )
        public
    {
        payoutResolutionPrivate(resolutionId, Gov.Action.ExtraordinaryPayout, resolutionDocumentUrl);
    }

    ////////////////////////
    // Internal Methods
    ////////////////////////

    function receiveDividend(address wallet, uint256 amount, bytes memory data)
        internal
        returns (bool)
    {
        // check if data contains one of known selectors
        bytes4 sig;
        assembly {
            // skip length prefix of bytes
            sig := mload(add(data, 32))
        }
        if (sig != this.ordinaryPayoutResolution.selector && sig != this.extraOrdinaryPayoutResolution.selector) {
            // we cannot process this payout
            return false;
        }
        // wallet must be company
        require(wallet == _g.COMPANY_LEGAL_REPRESENTATIVE, "NF_DIVIDEND_ONLY_COMPANY");
        // take resolution, token and amount from data
        IERC223Token paymentToken;
        bytes32 resolutionId;
        uint256 promisedAmount;
        uint256 recycleAfter;
        assembly {
            // add 4 to all pointers to skip selector
            // skip length prefix of bytes + selector = 36
            resolutionId := mload(add(data, 36))
            // skip 32 + 4 + 32 = 68
            // load memory area that is unpacked address
            paymentToken := mload(add(data, 68))
            promisedAmount := mload(add(data, 100))
            recycleAfter := mload(add(data, 132))
        }
        // msg.sender must match
        require(paymentToken == msg.sender && amount == promisedAmount, "NF_DIVIDEND_PAYMENT_MISMATCH");
        // data must contain original call data of resolution so promise matches
        completePayout(resolutionId, paymentToken, amount, recycleAfter, keccak256(data));
        return true;
    }

    ////////////////////////
    // Private Methods
    ////////////////////////
    function completePayout(bytes32 resolutionId, IERC223Token paymentToken, uint256 amount, uint256 recycleAfter, bytes32 promise)
        private
        withAtomicContinuedExecution(resolutionId, promise, 0)
    {
        // fee disbursal expect token address and recycle after packed
        bytes memory serializedAddress = abi.encodePacked(address(_t._token), recycleAfter);
        IFeeDisbursal disbursal = IFeeDisbursal(_g.UNIVERSE.feeDisbursal());
        if (amount > 0) {
            // disburse via ERC223, where we encode token used to provide pro-rata in `data` parameter
            assert(paymentToken.transfer(disbursal, amount, serializedAddress));
        }
    }

    function payoutResolutionPrivate(
        bytes32 resolutionId,
        Gov.Action action,
        // IERC223Token /*paymentToken*/,
        string resolutionDocumentUrl
    )
        private
        onlyOperational
        withNonAtomicExecution(resolutionId, payoutValidator)
        withGovernance(
            resolutionId,
            action,
            resolutionDocumentUrl
        )
    {}

    function payoutValidator(Gov.ResolutionExecution storage /*e*/)
        private
        constant
        returns (string memory code)
    {
        if (_t._token == address(0)) {
            return "NF_NO_PRORATA_TOKEN";
        }
        // unpack calldata to extract address payload
        IERC223Token paymentToken;
        uint256 amount;
        assembly {
            // skip 4 bytes selector and 32 bytes resolution id
            // _rId := calldataload(4)
            paymentToken := calldataload(36)
            amount := calldataload(68)
        }
        require(amount > 0);
        if (!_g.UNIVERSE.isInterfaceCollectionInstance(KNOWN_INTERFACE_PAYMENT_TOKEN, paymentToken)) {
            return "NF_NOT_PAYMENT_TOKEN";
        }
    }
}
