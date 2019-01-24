pragma solidity 0.4.25;

import "../Universe.sol";
import "../PlatformTerms.sol";
import "../Standards/IFeeDisbursal.sol";
import "../Serialization.sol";
import "../Math.sol";
import "../Standards/IERC223Token.sol";
import "../Standards/IFeeDisbursalController.sol";
import "../Standards/IERC223LegacyCallback.sol";
import "../Standards/IERC223Callback.sol";
import "../Standards/ITokenSnapshots.sol";
import "../Compat/ERC223LegacyCallbackCompat.sol";
import "../KnownContracts.sol";

/// @title granular fee disbursal contract
contract FeeDisbursal is
    IERC223Callback,
    IERC223LegacyCallback,
    ERC223LegacyCallbackCompat,
    Serialization,
    Math,
    KnownContracts
{

    ////////////////////////
    // Events
    ////////////////////////

    event LogDisbursalCreated(
        address indexed proRataToken,
        address indexed token,
        uint256 amount,
        uint256 recycleAfterDuration,
        address disburser
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
        uint256 amount
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
        // time after which claims to this token can be recycled
        uint256 recycleableAfterTimestamp;
        // contract sending the disbursal
        address disburser;
    }

    ////////////////////////
    // Constants
    ////////////////////////
    uint256 constant UINT256_MAX = 2**256 - 1;


    ////////////////////////
    // Immutable state
    ////////////////////////
    Universe private UNIVERSE;

    ////////////////////////
    // Mutable state
    ////////////////////////

    // controller instance
    IFeeDisbursalController private _feeDisbursalController;
    // map claimable token address to pro rata token adresses to a list of disbursal events of that token
    mapping (address => mapping(address => Disbursal[])) private _disbursals;
    // mapping to track what disbursals have already been paid out to which user
    // claimable token address => pro rata token address => user address => next disbursal index to be claimed
    mapping (address => mapping(address => mapping(address => uint256))) _disbursalProgress;


    ////////////////////////
    // Constructor
    ////////////////////////
    constructor(Universe universe, IFeeDisbursalController controller)
        public
    {
        require(universe != address(0x0));
        (bytes32 controllerContractId, ) = controller.contractId();
        require(controllerContractId == FEE_DISBURSAL_CONTROLLER);
        UNIVERSE = universe;
        _feeDisbursalController = controller;
    }

    ////////////////////////
    // Public functions
    ////////////////////////

    /// @notice get the disbursal at a given index for a given token
    /// @param token address of the claimable token
    /// @param proRataToken address of the token used to determine the user pro rata amount, must be a snapshottoken
    /// @param index until what index to claim to
    function getDisbursal(address token, address proRataToken, uint256 index)
        public
        constant
    returns (
        uint256 snapshotId,
        uint256 amount,
        uint256 recycleableAfterTimestamp,
        address disburser
    )
    {
        Disbursal storage disbursal = _disbursals[token][proRataToken][index];
        snapshotId = disbursal.snapshotId;
        amount = disbursal.amount;
        recycleableAfterTimestamp = disbursal.recycleableAfterTimestamp;
        disburser = disbursal.disburser;
    }

    /// @notice get count of disbursals for given token
    /// @param token address of the claimable token
    /// @param proRataToken address of the token used to determine the user pro rata amount, must be a snapshottoken
    function getDisbursalCount(address token, address proRataToken)
        public
        constant
        returns (uint256)
    {
        return _disbursals[token][proRataToken].length;
    }

    /// @notice accepts the token disbursal offer and claim offered tokens, to be called by an investor
    /// @param token address of the claimable token
    /// @param proRataToken address of the token used to determine the user pro rata amount, must be a snapshottoken
    /// @param until until what index to claim to, noninclusive, use 2**256 to accept all disbursals
    function accept(address token, ITokenSnapshots proRataToken, uint256 until)
        public
    {
        // only allow verified and active accounts to claim tokens
        require(_feeDisbursalController.onAccept(token, proRataToken, msg.sender), "NF_VERIFICATION_REQUIRED");
        (uint256 claimedAmount, , uint256 nextIndex) = claimPrivate(token, proRataToken, msg.sender, until);

        // do the actual token transfer
        if (claimedAmount > 0) {
            IERC223Token ierc223Token = IERC223Token(token);
            assert(ierc223Token.transfer(msg.sender, claimedAmount, ""));
        }
        // log
        emit LogDisbursalAccepted(msg.sender, token, proRataToken, claimedAmount, nextIndex);
    }

    /// @notice accepts disbursals of multiple tokens and receives them, to be called an investor
    /// @param tokens addresses of the claimable token
    /// @param proRataToken address of the token used to determine the user pro rata amount, must be a snapshottoken
    function acceptMultiple(address[] tokens, ITokenSnapshots proRataToken)
        public
    {
        uint256[2][] memory claimed = new uint256[2][](tokens.length);
        // first gather the funds
        uint256 i;
        uint256 totalAmount;
        for (i = 0; i < tokens.length; i += 1) {
            // only allow verified and active accounts to claim tokens
            require(_feeDisbursalController.onAccept(tokens[i], proRataToken, msg.sender), "NF_VERIFICATION_REQUIRED");
            (claimed[0][i], totalAmount, claimed[1][i]) = claimPrivate(tokens[i], proRataToken, msg.sender, UINT256_MAX);
        }
        // then perform actual transfers, after all state changes are done, to prevent re-entry
        for (i = 0; i < tokens.length; i += 1) {
            if (claimed[0][i] > 0) {
                // do the actual token transfer
                IERC223Token ierc223Token = IERC223Token(tokens[i]);
                assert(ierc223Token.transfer(msg.sender, claimed[0][i], ""));
            }
            // log
            emit LogDisbursalAccepted(msg.sender, tokens[i], proRataToken, claimed[0][i], claimed[1][i]);
        }
    }

    /// @notice rejects disbursal of token which leads to recycle and disbursal of rejected amount
    /// @param token address of the claimable token
    /// @param proRataToken address of the token used to determine the user pro rata amount, must be a snapshottoken
    /// @param until until what index to claim to, noninclusive, use 2**256 to reject all disbursals
    function reject(address token, ITokenSnapshots proRataToken, uint256 until)
        public
    {
        // only allow verified and active accounts to claim tokens
        require(_feeDisbursalController.onReject(token, address(0), msg.sender), "NF_VERIFICATION_REQUIRED");
        (uint256 claimedAmount, , uint256 nextIndex) = claimPrivate(token, proRataToken, msg.sender, until);
        // what was rejected will be recycled
        if (claimedAmount > 0) {
            PlatformTerms terms = PlatformTerms(UNIVERSE.platformTerms());
            disburse(token, this, claimedAmount, proRataToken, terms.DEFAULT_DISBURSAL_RECYCLE_AFTER_DURATION());
        }
        // log
        emit LogDisbursalRejected(msg.sender, token, proRataToken, claimedAmount, nextIndex);
    }

    /// @notice check how many tokens of a certain kind can be claimed by an account
    /// @param token address of the claimable token
    /// @param proRataToken address of the token used to determine the user pro rata amount, must be a snapshottoken
    /// @param claimer address of the claimer that would receive the funds
    /// @param until until what index to claim to, noninclusive, use 2**256 to reject all disbursals
    /// @return (amount that can be claimed, total disbursed amount, time to recycle of first disbursal, first disbursal index)
    function claimable(address token, ITokenSnapshots proRataToken, address claimer, uint256 until)
        public
        constant
    returns (uint256 claimableAmount, uint256 totalAmount, uint256 recycleableAfterTimestamp, uint256 firstIndex)
    {
        firstIndex = _disbursalProgress[token][proRataToken][claimer];
        recycleableAfterTimestamp = _disbursals[token][proRataToken][firstIndex].recycleableAfterTimestamp;
        // we don't do to a verified check here, this serves purely to check how much is claimable for an address
        (claimableAmount, totalAmount,) = claimablePrivate(token, proRataToken, claimer, until, false);
    }

    /// @notice claim a token, to be called an investor
    /// @param tokens addresses of the claimable token
    /// @param proRataToken address of the token used to determine the user pro rata amount, must be a snapshottoken
    /// @param claimer address of the claimer that would receive the funds
    /// @return array of (amount that can be claimed, total disbursed amount, time to recycle of first disbursal, first disbursal index)
    function claimableMutiple(address[] tokens, ITokenSnapshots proRataToken, address claimer)
        public
        constant
    returns (uint256[4][] claimables)
    {
        // we don't to do a verified check here, this serves purely to check how much is claimable for an address
        claimables = new uint256[4][](tokens.length);
        for (uint256 i = 0; i < tokens.length; i += 1) {
            claimables[3][i] = _disbursalProgress[tokens[i]][proRataToken][claimer];
            claimables[2][i] = _disbursals[tokens[i]][proRataToken][claimables[3][i]].recycleableAfterTimestamp;
            (claimables[0][i], claimables[1][i], ) = claimablePrivate(tokens[i], proRataToken, claimer, UINT256_MAX, false);
        }
    }

    /// @notice recycle a token for multiple investors
    /// @param token address of the recyclable token
    /// @param investors list of investors we want to recycle tokens for
    /// @param until until what index to recycle to
    function recycle(address token, ITokenSnapshots proRataToken, address[] investors, uint256 until)
        public
    {
        require(_feeDisbursalController.onRecycle(token, proRataToken, investors, until), "");
        // cycle through all investors collect the claimable and recycleable funds
        // also move the _disbursalProgress pointer
        uint256 totalClaimableAmount = 0;
        for (uint256 i = 0; i < investors.length; i += 1) {
            (uint256 claimableAmount, ,uint256 nextIndex) = claimablePrivate(token, ITokenSnapshots(proRataToken), investors[i], until, true);
            totalClaimableAmount += claimableAmount;
            _disbursalProgress[token][proRataToken][investors[i]] = nextIndex;
        }

        // skip disbursal if amount == 0
        if (totalClaimableAmount > 0) {
            // now re-disburse, we're now the disburser
            PlatformTerms terms = PlatformTerms(UNIVERSE.platformTerms());
            disburse(token, this, totalClaimableAmount, proRataToken, terms.DEFAULT_DISBURSAL_RECYCLE_AFTER_DURATION());
        }

        // log
        emit LogFundsRecycled(proRataToken, token, totalClaimableAmount);
    }

    /// @notice check how much we can recycle for multiple investors
    /// @param token address of the recyclable token
    /// @param investors list of investors we want to recycle tokens for
    /// @param until until what index to recycle to
    function recycleable(address token, ITokenSnapshots proRataToken, address[] investors, uint256 until)
        public
        constant
    returns (uint256)
    {
        // cycle through all investors collect the claimable and recycleable funds
        uint256 totalAmount = 0;
        for (uint256 i = 0; i < investors.length; i += 1) {
            (uint256 claimableAmount,,) = claimablePrivate(token, proRataToken, investors[i], until, true);
            totalAmount += claimableAmount;
        }
        return totalAmount;
    }

    /// @notice get current controller
    function feeDisbursalController()
        public
        constant
        returns (IFeeDisbursalController)
    {
        return _feeDisbursalController;
    }

    /// @notice update current controller
    function changeFeeDisbursalController(IFeeDisbursalController newController)
        public
    {
        require(_feeDisbursalController.onChangeFeeDisbursalController(msg.sender, newController));
        address oldController = address(_feeDisbursalController);
        _feeDisbursalController = newController;
        emit LogChangeFeeDisbursalController(oldController, address(newController), msg.sender);
    }

    /// @notice implementation of tokenfallback, calls the internal disburse function
    /// legacy onTokenTransfer is also supported via imported file
    function tokenFallback(address wallet, uint256 amount, bytes data)
        public
    {
        uint256 recycleAfterDuration;
        ITokenSnapshots proRataToken;
        PlatformTerms terms = PlatformTerms(UNIVERSE.platformTerms());
        recycleAfterDuration = terms.DEFAULT_DISBURSAL_RECYCLE_AFTER_DURATION();
        if (data.length == 20) {
            proRataToken = ITokenSnapshots(decodeAddress(data));
        }
        else if (data.length == 52) {
            address proRataTokenAddress;
            (proRataTokenAddress, recycleAfterDuration) = decodeAddressUInt256(data);
            proRataToken = ITokenSnapshots(proRataTokenAddress);
        } else {
            // legacy ICBMLockedAccount compat mode which does not send pro rata token address and we assume NEU
            proRataToken = UNIVERSE.neumark();
        }
        disburse(msg.sender, wallet, amount, proRataToken, recycleAfterDuration);
    }


    ////////////////////////
    // Private functions
    ////////////////////////

    /// @notice create a new disbursal
    /// @param token address of the token to disburse
    /// @param disburser address of the actor disbursing (e.g. eto commitment)
    /// @param amount amount of the disbursable tokens
    /// @param proRataToken address of the token that defines the pro rata
    function disburse(address token, address disburser, uint256 amount, ITokenSnapshots proRataToken, uint256 recycleAfterDuration)
        private
    {
        require(
            _feeDisbursalController.onDisburse(token, disburser, amount, address(proRataToken), recycleAfterDuration), "NF_DISBURSAL_REJECTED");

        uint256 snapshotId = proRataToken.currentSnapshotId();
        uint256 proRataTokenTotalSupply = proRataToken.totalSupplyAt(snapshotId);
        require(proRataTokenTotalSupply > 0, "NF_NO_DISBURSE_EMPTY_TOKEN");

        Disbursal[] storage disbursals = _disbursals[token][proRataToken];
        // try to merge with an existing disbursal
        // TODO: only go 100 iterations deep, not till UINT256_MAX (overflow)
        bool merged = false;
        for ( uint256 i = disbursals.length - 1; i != UINT256_MAX; i-- ) {
            // we can only merge if we have the same snapshot id
            // we can break here, as continuing down the loop the snapshot ids will decrease
            Disbursal storage disbursal = disbursals[i];
            if ( disbursal.snapshotId < snapshotId) {
                break;
            }
            // the existing disbursal must be the same on number of params so we can merge
            // disbursal.snapshotId is guaranteed to == proRataToken.currentSnapshotId()
            if ( disbursal.disburser == disburser ) {
                merged = true;
                disbursal.amount += amount;
                disbursal.recycleableAfterTimestamp = block.timestamp + recycleAfterDuration;
                break;
            }
        }

        // create a new disbursal entry
        if (!merged) {
            disbursals.push(Disbursal({
                recycleableAfterTimestamp: block.timestamp + recycleAfterDuration,
                amount: amount,
                snapshotId: snapshotId,
                disburser: disburser
            }));
        }

        emit LogDisbursalCreated(proRataToken, token, amount, recycleAfterDuration, disburser);
    }


    /// @notice claim a token for an claimer, returns the amount of tokens claimed
    /// @param token address of the claimable token
    /// @param claimer address of the claimer that will receive the funds
    /// @param until until what index to claim to
    function claimPrivate(address token, ITokenSnapshots proRataToken, address claimer, uint256 until)
        internal
    returns (uint256 claimedAmount, uint256 totalAmount, uint256 nextIndex)
    {
        (claimedAmount, totalAmount, nextIndex) = claimablePrivate(token, proRataToken, claimer, until, false);

        // mark claimer disbursal progress
        _disbursalProgress[token][proRataToken][claimer] = nextIndex;
    }

    /// @notice get the amount of tokens that can be claimed by a given claimer
    /// @param token address of the claimable token
    /// @param claimer address of the claimer that will receive the funds
    /// @param until until what index to claim to, use UINT256_MAX for all
    /// @param onlyRecycleable show only claimable funds that can be recycled
    /// @return a tuple of (amount claimed, total amount disbursed, next disbursal index to be claimed)
    function claimablePrivate(address token, ITokenSnapshots proRataToken, address claimer, uint256 until, bool onlyRecycleable)
        internal
        constant
        returns (uint256 claimableAmount, uint256 totalAmount, uint256 nextIndex)
    {
        nextIndex = min(until, _disbursals[token][proRataToken].length);
        uint256 currentIndex = _disbursalProgress[token][proRataToken][claimer];
        uint256 currentSnapshotId = proRataToken.currentSnapshotId();
        for (; currentIndex < nextIndex; currentIndex += 1) {
            Disbursal storage disbursal = _disbursals[token][proRataToken][currentIndex];
            uint256 snapshotId = disbursal.snapshotId;
            // do not pay out claims from the current snapshot
            if ( snapshotId == currentSnapshotId )
                break;
            // in case of just determining the recyclable amount of tokens, break when we
            // cross this time, this also assumes disbursal.recycleableAfterTimestamp in each disbursal is the same or increases
            // in case it decreases, recycle will not be possible until 'blocking' disbursal also expires
            if ( onlyRecycleable && disbursal.recycleableAfterTimestamp > block.timestamp )
                break;
            // add to total amount
            totalAmount += disbursal.amount;
            // add claimable amount
            claimableAmount += calculateClaimableAmount(claimer, disbursal.amount, proRataToken, snapshotId);
        }
        return (claimableAmount, totalAmount, currentIndex);
    }

    function calculateClaimableAmount(address claimer, uint256 disbursalAmount, ITokenSnapshots proRataToken, uint256 snapshotId)
        private
        constant
        returns (uint256)
    {
        uint256 proRataClaimerBalance = proRataToken.balanceOfAt(claimer, snapshotId);
        // if no balance then continue
        if (proRataClaimerBalance == 0) {
            return 0;
        }
        // compute pro rata amount
        uint256 proRataTokenTotalSupply = proRataToken.totalSupplyAt(snapshotId);
        // TODO: prove that rounding errors do not accumulate here
        return proportion(disbursalAmount, proRataClaimerBalance, proRataTokenTotalSupply);
    }
}
