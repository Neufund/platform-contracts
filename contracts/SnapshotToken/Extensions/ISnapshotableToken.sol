pragma solidity 0.4.26;

import "../../Standards/IBasicToken.sol";
import "../../Standards/ISnapshotable.sol";
import "../../Standards/ITokenSnapshots.sol";


contract ISnapshotableToken is ISnapshotable, ITokenSnapshots, IBasicToken {

}
