pragma solidity 0.4.25;

import "./IERC223Callback.sol";
import "./IERC223LegacyCallback.sol";
import "./IERC677Callback.sol";
import "../Compat/ERC223LegacyCallbackCompat.sol";
import "../Standards/IContractId.sol";
import "../Standards/ITokenSnapshots.sol";
import "../Standards/IFeeDisbursalController.sol";

/// @title disburse payment token amount to snapshot token holders
/// @dev payment token received via ERC223 Transfer
contract IFeeDisbursal is
    IERC223Callback,
    IERC677Callback,
    IERC223LegacyCallback,
    ERC223LegacyCallbackCompat,
    IContractId
    {

    ////////////////////////
    // Events
    ////////////////////////

    event LogDisbursalCreated(
        address indexed proRataToken,
        address indexed token,
        uint256 amount,
        uint256 recycleAfterDuration,
        address disburser,
        uint256 index
    );

    event LogDisbursalAccepted(
        address indexed claimer,
        address token,
        address proRataToken,
        uint256 amount,
        uint256 nextIndex
    );

    event LogDisbursalRejected(
        address indexed claimer,
        address token,
        address proRataToken,
        uint256 amount,
        uint256 nextIndex
    );

    event LogFundsRecycled(
        address indexed proRataToken,
        address indexed token,
        uint256 amount,
        address by
    );

    event LogChangeFeeDisbursalController(
        address oldController,
        address newController,
        address by
    );

    ////////////////////////
    // Types
    ////////////////////////
    struct Disbursal {
        // snapshop ID of the pro-rata token, which will define which amounts to disburse against
        uint256 snapshotId;
        // amount of tokens to disburse
        uint256 amount;
        // timestamp after which claims to this token can be recycled
        uint128 recycleableAfterTimestamp;
        // timestamp on which token were disbursed
        uint128 disbursalTimestamp;
        // contract sending the disbursal
        address disburser;
    }

    ////////////////////////
    // Constants
    ////////////////////////
    uint256 internal constant UINT256_MAX = 2**256 - 1;


    ////////////////////////
    // Public functions
    ////////////////////////

    /// @notice get the disbursal at a given index for a given token
    /// @param token address of the disbursable token
    /// @param proRataToken address of the token used to determine the user pro rata amount, must be a snapshottoken
    /// @param index until what index to claim to
    function getDisbursal(address token, address proRataToken, uint256 index)
        public
        constant
    returns (
        uint256 snapshotId,
        uint256 amount,
        uint256 recycleableAfterTimestamp,
        uint256 disburseTimestamp,
        address disburser
        );

    /// @notice get disbursals for current snapshot id of the proRataToken that cannot be claimed yet
    /// @param token address of the disbursable token
    /// @param proRataToken address of the token used to determine the user pro rata amount, must be a snapshottoken
    /// @return array of (snapshotId, amount, index) ordered by index. full disbursal information can be retrieved via index
    function getNonClaimableDisbursals(address token, address proRataToken)
        public
        constant
        returns (uint256[3][] memory disbursals);

    /// @notice get count of disbursals for given token
    /// @param token address of the disbursable token
    /// @param proRataToken address of the token used to determine the user pro rata amount, must be a snapshottoken
    function getDisbursalCount(address token, address proRataToken)
        public
        constant
        returns (uint256);

    /// @notice accepts the token disbursal offer and claim offered tokens, to be called by an investor
    /// @param token address of the disbursable token
    /// @param proRataToken address of the token used to determine the user pro rata amount, must be a snapshottoken
    /// @param until until what index to claim to, noninclusive, use 2**256 to accept all disbursals
    function accept(address token, ITokenSnapshots proRataToken, uint256 until)
        public;

    /// @notice accepts disbursals of multiple tokens and receives them, to be called an investor
    /// @param tokens addresses of the disbursable token
    /// @param proRataToken address of the token used to determine the user pro rata amount, must be a snapshottoken
    function acceptMultipleByToken(address[] tokens, ITokenSnapshots proRataToken)
        public;

    /// @notice accepts disbursals for single token against many pro rata tokens
    /// @param token address of the disbursable token
    /// @param proRataTokens addresses of the tokens used to determine the user pro rata amount, must be a snapshottoken
    /// @dev this should let save a lot on gas by eliminating multiple transfers and some checks
    function acceptMultipleByProRataToken(address token, ITokenSnapshots[] proRataTokens)
        public;

    /// @notice rejects disbursal of token which leads to recycle and disbursal of rejected amount
    /// @param token address of the disbursable token
    /// @param proRataToken address of the token used to determine the user pro rata amount, must be a snapshottoken
    /// @param until until what index to claim to, noninclusive, use 2**256 to reject all disbursals
    function reject(address token, ITokenSnapshots proRataToken, uint256 until)
        public;

    /// @notice check how many tokens of a certain kind can be claimed by an account
    /// @param token address of the disbursable token
    /// @param proRataToken address of the token used to determine the user pro rata amount, must be a snapshottoken
    /// @param claimer address of the claimer that would receive the funds
    /// @param until until what index to claim to, noninclusive, use 2**256 to reject all disbursals
    /// @return (amount that can be claimed, total disbursed amount, time to recycle of first disbursal, first disbursal index)
    function claimable(address token, ITokenSnapshots proRataToken, address claimer, uint256 until)
        public
        constant
        returns (uint256 claimableAmount, uint256 totalAmount, uint256 recycleableAfterTimestamp, uint256 firstIndex);

    /// @notice check how much fund for each disbursable tokens can be claimed by claimer
    /// @param tokens addresses of the disbursable token
    /// @param proRataToken address of the token used to determine the user pro rata amount, must be a snapshottoken
    /// @param claimer address of the claimer that would receive the funds
    /// @return array of (amount that can be claimed, total disbursed amount, time to recycle of first disbursal, first disbursal index)
    /// @dev claimbles are returned in the same order as tokens were specified
    function claimableMutipleByToken(address[] tokens, ITokenSnapshots proRataToken, address claimer)
        public
        constant
        returns (uint256[4][] claimables);

    /// @notice check how many tokens can be claimed against many pro rata tokens
    /// @param token address of the disbursable token
    /// @param proRataTokens addresses of the tokens used to determine the user pro rata amount, must be a snapshottoken
    /// @param claimer address of the claimer that would receive the funds
    /// @return array of (amount that can be claimed, total disbursed amount, time to recycle of first disbursal, first disbursal index)
    function claimableMutipleByProRataToken(address token, ITokenSnapshots[] proRataTokens, address claimer)
        public
        constant
        returns (uint256[4][] claimables);


    /// @notice recycle a token for multiple investors
    /// @param token address of the recyclable token
    /// @param proRataToken address of the token used to determine the user pro rata amount, must be a snapshottoken
    /// @param investors list of investors we want to recycle tokens for
    /// @param until until what index to recycle to
    function recycle(address token, ITokenSnapshots proRataToken, address[] investors, uint256 until)
        public;

    /// @notice check how much we can recycle for multiple investors
    /// @param token address of the recyclable token
    /// @param proRataToken address of the token used to determine the user pro rata amount, must be a snapshottoken
    /// @param investors list of investors we want to recycle tokens for
    /// @param until until what index to recycle to
    function recycleable(address token, ITokenSnapshots proRataToken, address[] investors, uint256 until)
        public
        constant
        returns (uint256);

    /// @notice get current controller
    function feeDisbursalController()
        public
        constant
        returns (IFeeDisbursalController);

    /// @notice update current controller
    function changeFeeDisbursalController(IFeeDisbursalController newController)
        public;
}
