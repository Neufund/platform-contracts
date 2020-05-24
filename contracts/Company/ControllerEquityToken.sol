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

    function tokens()
        public
        constant
        returns (
            address[1] token,
            Gov.TokenType[1] tokenType,
            Gov.TokenState[1] tokenState,
            address[1] holderRights,
            bool[1] tokenTransferable
        )
    {
        token[0] = _t._token;
        tokenType[0] = _t._type;
        tokenState[0] = _t._state;
        holderRights[0] = _t._tokenholderRights;
        tokenTransferable[0] = _t._transferable;
    }

    //
    // Migration storage access
    //

    function migrateToken(
        IControlledToken token,
        Gov.TokenType tokenType,
        Gov.TokenState state,
        EquityTokenholderRights rights,
        bool transfersEnabled
    )
        public
        onlyState(Gov.State.Setup)
        only(ROLE_COMPANY_UPGRADE_ADMIN)
    {
        _t._type = tokenType;
        _t._state = state;
        _t._transferable = transfersEnabled;
        _t._token = token;
        _t._tokenholderRights = rights;

        if (tokenType == Gov.TokenType.Equity) {
            Gov.setAdditionalEquityTokenData(_t, IEquityToken(token));
        }
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
}
