pragma solidity 0.4.25;

import "../Universe.sol";
import "../Standards/IFeeDisbursal.sol";
import "../SnapshotToken/BasicSnapshotToken.sol";
import "../Serialization.sol";
import "../Math.sol";
import "../Standards/IERC223Token.sol";
import "../Standards/IFeeDisbursalController.sol";
import "../Standards/IERC223LegacyCallback.sol";
import "../Compat/IERC223LegacyCallbackCompat.sol";

contract FeeDisbursal is
    IERC223LegacyCallback,
    IERC223LegacyCallbackCompat,
    Serialization,
    Math
{

    ////////////////////////
    // Events
    ////////////////////////

    event LogDisbursalCreated(
        address indexed token,
        address disburser,
        uint256 amount,
        address proRataToken
    );

    event LogDisbursalClaimed(
        address indexed claimer,
        address token,
        uint256 amount,
        uint256 lastIndex
    );

    ////////////////////////
    // Types
    ////////////////////////
    struct Disbursal {
        // snapshop ID of the pro-rata token, which will define which amounts to disburse against
        uint256 snapshotId;
        // amount of tokens to disburse
        uint256 amount;
        // address of the token used to determine the user pro rata amount, must be a snapshottoken, default is NEU
        BasicSnapshotToken proRataToken;
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
    // map token addresses to a list of disbursal events of that token
    mapping (address => Disbursal[]) private _disbursals;
    // mapping to track what disbursals have already been paid out to which user
    // token address => user address => disbursal progress
    mapping (address => mapping(address => uint256)) _disbursalProgress;


    ////////////////////////
    // Constructor
    ////////////////////////
    constructor(Universe universe, IFeeDisbursalController controller)
        public
    {
        require(universe != address(0x0));
        require(controller != address(0x0));
        UNIVERSE = universe;
        _feeDisbursalController = controller;
    }

    ////////////////////////
    // Public functions
    ////////////////////////

    /// @notice get the disbursal at a given index for a given token
    /// @param token address of the claimable token
    /// @param index until what index to claim to
    function getDisbursal(address token, uint256 index)
    public
    constant
    returns (
        uint256 snapshotId,
        uint256 amount,
        BasicSnapshotToken proRataToken,
        uint256 recycleableAfterTimestamp,
        address disburser
    )
    {
        Disbursal storage disbursal = _disbursals[token][index];
        snapshotId = disbursal.snapshotId;
        amount = disbursal.amount;
        proRataToken = disbursal.proRataToken;
        recycleableAfterTimestamp = disbursal.recycleableAfterTimestamp;
        disburser = disbursal.disburser;
    }

    /// @notice get count of disbursals for given token
    /// @param token address of the claimable token
    function getDisbursalCount(address token)
    public
    constant
    returns (uint256)
    {
        return _disbursals[token].length;
    }

    /// @notice claim a token, to be called an investor
    /// @param token address of the claimable token
    /// @param until until what index to claim to
    function claim(address token, uint256 until)
    public
    {
        // only allow verified and active accounts to claim tokens
        require(_feeDisbursalController.onClaim(token, msg.sender), "");
        (uint256 claimedAmount, uint256 lastIndex) = claimPrivate(token, msg.sender, until);
    }

    /// @notice claim multiple tokens, to be called an investor
    /// @param tokens addresses of the claimable token
    function claimMultiple(address[] tokens)
    public
    {
        // only allow verified and active accounts to claim tokens
        for (uint256 i = 0; i < tokens.length; i += 1) {
            require(_feeDisbursalController.onClaim(tokens[i], msg.sender), "");
            (uint256 claimedAmount, uint256 lastIndex) = claimPrivate(tokens[i], msg.sender, UINT256_MAX);
        }
    }

    /// @notice check how many tokens of a certain kind can be claimed by an account
    /// @param token address of the claimable token
    /// @param spender address of the spender that would receive the funds
    /// @param until until what index to claim to
    function claimable(address token, address spender, uint256 until)
    public
    constant
    returns (uint256 claimableAmount, uint256 lastIndex)
    {   
        // we don't do to a verified check here, this serves purely to check how much is claimable for an address
        return claimablePrivate(token, spender, until, false);
    }

    /// @notice claim a token, to be called an investor
    /// @param tokens addresses of the claimable token
    /// @param spender address of the spender that would receive the funds
    function claimableMutiple(address[] tokens, address spender)
    public
    constant
    returns (uint256[])
    {   
        // we don't to do a verified check here, this serves purely to check how much is claimable for an address
        uint256[] memory result = new uint256[](tokens.length);
        for (uint256 i = 0; i < tokens.length; i += 1) {
            (uint256 claimableAmount, uint256 lastIndex) = claimablePrivate(tokens[i], spender, UINT256_MAX, false);
            result[i] = claimableAmount;
        }
        return result;
    }

    /// @notice claim a token, to be called an investor
    /// @param token address of the recyclable token
    /// @param investors list of investors we want to recycle tokens for
    /// @param until until what index to claim to
    function recycle(address token, address[] investors, uint256 until)
    public
    {        
        require(_feeDisbursalController.onRecycle(), "");
        // @TODO: Recycle funds
        // @TODO: add log message
    }

    // implementation of tokenfallback
    function tokenFallback(address wallet, uint256 amount, bytes data)
        public
    {
        // cast and check pro rata token
        // fallback is neumark
        BasicSnapshotToken proRataToken;
        if (data.length != 0) 
           proRataToken = BasicSnapshotToken(decodeAddress(data));
        else
            proRataToken = UNIVERSE.neumark();
        require(_feeDisbursalController.onDisburse(msg.sender, wallet, amount, address(proRataToken)), "");

        uint256 snapshotId = proRataToken.currentSnapshotId();
        uint256 proRataTokenTotalSupply = proRataToken.totalSupplyAt(snapshotId);
        require(proRataTokenTotalSupply > 0, "");

        Disbursal[] storage disbursals = _disbursals[msg.sender];

        // try to merge with an existing disbursal
        bool merged = false;
        for ( uint256 i = disbursals.length - 1; i < disbursals.length; i-- ) {
            // we can only merge if we have the same snapshot id
            // we can break here, as continuing down the loop the snapshot ids will decrease
            Disbursal storage disbursal = disbursals[i];
            if ( disbursal.snapshotId < snapshotId )
                break;
            // the existing disbursal must be the same on  number of params so we can merge
            if (
                disbursal.proRataToken == proRataToken &&
                disbursal.disburser == wallet) {
                merged = true;
                disbursal.amount += amount;
            }
        }

        // create a new disbursal entry
        if (!merged) 
            disbursals.push(Disbursal({
                recycleableAfterTimestamp: block.timestamp + 1 years,
                amount: amount,
                proRataToken: proRataToken,
                snapshotId: snapshotId,
                disburser: wallet
            }));

        emit LogDisbursalCreated(msg.sender, wallet, amount, proRataToken);
    }


    ////////////////////////
    // Private functions
    ////////////////////////

    /// @notice claim a token for an spender, returns the amount of tokens claimed
    /// @param token address of the claimable token
    /// @param spender address of the spender that will receive the funds
    /// @param until until what index to claim to
    function claimPrivate(address token, address spender, uint256 until)
    public
    returns (uint256 claimedAmount, uint256 lastIndex)
    {
        (claimedAmount, lastIndex) = claimablePrivate(token, spender, until, false);

        // mark spender disbursal progress
        _disbursalProgress[token][spender] = lastIndex;

        // do the actual token transfer
        IERC223Token ierc223Token = IERC223Token(token);
        ierc223Token.transfer(spender, claimedAmount, "");

        // log
        emit LogDisbursalClaimed(spender, token, claimedAmount, lastIndex);
    }

    /// @notice get the amount of tokens that can be claimed by a given spender
    /// @param token address of the claimable token
    /// @param spender address of the spender that will receive the funds
    /// @param until until what index to claim to, use UINT256_MAX for all
    /// @param onlyRecycleable show only claimable funds that can be recycled
    function claimablePrivate(address token, address spender, uint256 until, bool onlyRecycleable)
    public
    constant
    returns (uint256 claimableAmount, uint256 lastIndex)
    {
        lastIndex = min(until, _disbursals[token].length);
        claimableAmount = 0;
        for (uint256 i = _disbursalProgress[token][spender]; i < lastIndex; i += 1) {
            Disbursal storage disbursal = _disbursals[token][i];
            // in case of just determining the recyclable amount of tokens, break when we
            // cross this time
            if ( onlyRecycleable && disbursal.recycleableAfterTimestamp > block.timestamp )
                break;
            BasicSnapshotToken proRataToken = BasicSnapshotToken(disbursal.proRataToken);
            uint256 snapshotId = disbursal.snapshotId;
            // do not pay out claims from the current snapshot
            if ( snapshotId == proRataToken.currentSnapshotId() )
                break;
            uint256 proRataTokenTotalSupply = proRataToken.totalSupplyAt(snapshotId);
            uint256 proRataSpenderBalance = proRataToken.balanceOfAt(spender, snapshotId);
            if (proRataTokenTotalSupply == 0) continue;
            // this should round down, so we should not be spending more than we have in our balance
            claimableAmount += proportion(disbursal.amount, proRataSpenderBalance, proRataTokenTotalSupply);
        }
        return (claimableAmount, lastIndex);
    }

    // @TODO add mechanism to switch out the controller

}