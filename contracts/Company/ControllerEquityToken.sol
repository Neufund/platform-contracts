pragma solidity 0.4.26;

import "./ControllerGovernanceEngine.sol";

contract ControllerEquityToken is
    ControllerGovernanceEngine
{
    ////////////////////////
    // Governance Module Id
    ////////////////////////

    bytes32 internal constant ControllerEquityTokenId = 0x76a4af32c7ac3d96283e121f8ebe6756f83a719635f832b64ad5c6da800ed89f;
    uint256 internal constant ControllerEquityTokenV = 0;

    ////////////////////////
    // Events
    ////////////////////////

    // logged when transferability of given token was changed
    event LogTransfersStateChanged(
        bytes32 indexed resolutionId,
        address equityToken,
        bool transfersEnabled
    );

    ////////////////////////
    // Constructor
    ////////////////////////

    constructor () internal {}

    function governanceToken()
        public
        constant
        returns (
            IControlledToken token,
            Gov.TokenType tokenType,
            Gov.TokenState tokenState,
            ITokenholderRights holderRights,
            bool tokenTransferable
        )
    {
        return (_t._token, _t._type, _t._state, _t._tokenholderRights, _t._transferable);
    }

    //
    // Migration storage access
    //

    function migrateToken(
        IControlledToken token,
        Gov.TokenType tokenType,
        Gov.TokenState state,
        ITokenholderRights rights,
        bool transfersEnabled
    )
        public
        onlyState(Gov.State.Setup)
        only(ROLE_COMPANY_UPGRADE_ADMIN)
    {
        Gov.setToken(_t, token, tokenType, state, rights, transfersEnabled);
    }

    ////////////////////////
    // Internal Methods
    ////////////////////////

    function enableTransfers(bytes32 resolutionId, bool transfersEnabled)
        internal
    {
        if (_t._transferable != transfersEnabled) {
            _t._transferable = transfersEnabled;
        }
        emit LogTransfersStateChanged(resolutionId, _t._token, transfersEnabled);
    }

    //
    // Observes MGovernanceObserver
    //

    function mAfterShareCapitalChange(uint256 newShareCapital)
        internal
    {
        // update total voting power of the equity token
        if (_t._type == Gov.TokenType.Equity) {
            Gov.setEquityTokenTotalVotingPower(_t, IEquityToken(_t._token), newShareCapital);
        }
    }
}
