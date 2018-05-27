pragma solidity 0.4.24;

import "../../Standards/IBasicToken.sol";
import "../../Standards/ISnapshotable.sol";
import "../../Standards/ITokenSnapshots.sol";


contract ISnapshotableToken is ISnapshotable, ITokenSnapshots, IBasicToken {

}
