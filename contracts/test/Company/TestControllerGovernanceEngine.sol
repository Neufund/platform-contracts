pragma solidity 0.4.26;

import "../../Company/ControllerGovernanceEngine.sol";

contract TestControllerGovernanceEngine is ControllerGovernanceEngine {

    ////////////////////////
    // Mutable Public State
    ////////////////////////

    address public addressPayload;

    address public invalidValidatorAddress = 0xcCA9fB1AFfA05fD1aD6A339379d4b7dd4301EB49;

    ////////////////////////
    // Constructor
    ////////////////////////

    constructor(
        Universe universe,
        address companyLegalRep,
        IEquityToken token,
        ITokenholderRights tokenholderRights,
        Gov.State state,
        uint256 shareCapital
    )
        public
        ControllerGovernanceEngine(universe, companyLegalRep)
    {
        Gov.setToken(_t, token, Gov.TokenType.Equity, Gov.TokenState.Open, tokenholderRights, true);
        // compute total voting power
        Gov.setEquityTokenTotalVotingPower(_t, token, shareCapital);
        transitionTo(state);
    }

    ////////////////////////
    // Public Methods
    ////////////////////////

    function executeAtomically(bytes32 resolutionId, address payload, Gov.Action action, string resolutionUrl)
        public
        onlyOperational
        withAtomicExecution(resolutionId, addressValidator)
        withGovernance(resolutionId, action, resolutionUrl)
    {
        executeResolution(resolutionId, 0xEA674fdDe714fd979de3EdF0F56AA9716B898ec8, payload);
    }

    function executeNonAtomically(bytes32 resolutionId, address payload, Gov.Action action, string resolutionUrl)
        public
        onlyOperational
        withNonAtomicExecution(resolutionId, addressValidator)
        withGovernance(resolutionId, action, resolutionUrl)
    {
        executeResolution(resolutionId, 0xEA674fdDe714fd979de3EdF0F56AA9716B898ec8, payload);
    }

    function continueNonAtomically(bytes32 resolutionId, address payload, Gov.Action /*action*/, string /*resolutionUrl*/)
        public
        onlyOperational
        withNonAtomicContinuedExecution(resolutionId, Gov.promiseForSelector(this.executeNonAtomically.selector), 0)
    {
        executeResolution(resolutionId, 0x7182B123AD5F6619B66533A85B6f180462AED05E, payload);
    }

    function finalizeAtomically(bytes32 resolutionId, address payload, Gov.Action /*action*/, string /*resolutionUrl*/)
        public
        onlyOperational
        withAtomicContinuedExecution(resolutionId, Gov.promiseForSelector(this.executeNonAtomically.selector), 0)
    {
        executeResolution(resolutionId, 0x3CB5a091E651d565d98b776a3E4AE51979Db76b2, payload);
    }

    // dev: in production code you never pass a step as not-promised parameter! it obviously defeats the purpose of step control
    function continueNonAtomicallyWithStep(bytes32 resolutionId, address payload, Gov.Action action, string resolutionUrl, uint8 nextStep)
        public
        onlyOperational
        withNonAtomicContinuedExecution(
            resolutionId,
            // next step is not a part of selector
            keccak256(abi.encodeWithSelector(this.executeNonAtomically.selector, resolutionId, payload, action, resolutionUrl)),
            nextStep
        )
    {
        executeResolution(resolutionId, 0x7182B123AD5F6619B66533A85B6f180462AED05E, payload);
    }

    function finalizeAtomicallyWithStep(bytes32 resolutionId, address payload, Gov.Action action, string resolutionUrl, uint8 nextStep)
        public
        onlyOperational
        withAtomicContinuedExecution(
            resolutionId,
            // next step is not a part of selector
            keccak256(abi.encodeWithSelector(this.executeNonAtomically.selector, resolutionId, payload, action, resolutionUrl)),
            nextStep
        )
    {
        executeResolution(resolutionId, 0x3CB5a091E651d565d98b776a3E4AE51979Db76b2, payload);
    }

    function continueNonAtomicallyWithExtraPayload(
        bytes32 resolutionId,
        address payload,
        Gov.Action action,
        string resolutionUrl,
        bytes32 extraPayload
    )
        public
        onlyOperational
        withNonAtomicContinuedExecution(
            resolutionId,
            // next step is not a part of selector
            keccak256(abi.encodeWithSelector(this.executeNonAtomically.selector, resolutionId, payload, action, resolutionUrl)),
            0
        )
    {
        Gov.ResolutionExecution storage e = _g._resolutions[resolutionId];
        // fill extra payload slot in resolution storage
        e.payload = extraPayload;
    }

    function addressValidator(Gov.ResolutionExecution storage /*e*/)
        internal
        constant
        returns (string memory code)
    {
        // unpack calldata to extract address payload
        address payload;
        assembly {
            // skip 4 bytes selector and 32 bytes resolution id
            // _rId := calldataload(4)
            payload := calldataload(36)
        }
        if (payload == invalidValidatorAddress) {
            code = "NF_TEST_INVALID_ADDR_PAYLOAD";
        }
    }

    function _setPayload(address payload)
        public
    {
        addressPayload = payload;
    }

    function _mockValidator(address payload)
        public
    {
        invalidValidatorAddress = payload;
    }

    //
    // Mock Methods
    //

    function _hasProposalPassed(
        uint8 action,
        uint256 inFavor,
        uint256 against,
        uint256 offchainInFavor,
        uint256 offchainAgainst,
        uint256 tokenVotingPower,
        uint256 totalVotingPower
    )
        public
        constant
        returns (Gov.ExecutionState)
    {
        Gov.ActionBylaw memory bylaw = Gov.deserializeBylaw(_t._tokenholderRights.getBylaw(action));
        return Gov.hasProposalPassed(inFavor, against, offchainInFavor, offchainAgainst, tokenVotingPower, totalVotingPower, bylaw);
    }

    ////////////////////////
    // Internal Methods
    ////////////////////////

    //
    // Observes MGovernanceObserver
    //

    function mAfterShareCapitalChange(uint256 /*newShareCapital*/)
        internal
    {}

    ////////////////////////
    // Private Methods
    ////////////////////////

    function executeResolution(bytes32 resolutionId, address invalidAddress, address payload)
        private
    {
        if (payload == invalidAddress) {
            // we fail resolution
            Gov.ResolutionExecution storage e = _g._resolutions[resolutionId];
            terminateResolutionWithCode(resolutionId, e, "NF_TEST_INVALID_ADDR_PAYLOAD");
        } else {
            // store payload - atomic execution modifier will complete resolution
            addressPayload = payload;
        }
    }
}
