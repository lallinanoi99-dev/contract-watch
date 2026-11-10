// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title WatchRegistry — the on-chain record of every Contract Watch watch.
/// @notice Stores who watches which contract, for which event, and a hash of the rule.
///         Alert channels (Telegram / Discord) never go on-chain — they live in the Worker only.
///         No tokens, no payments.
contract WatchRegistry {
    struct Watch {
        address owner;
        address target;
        uint32 chainId;
        bytes32 eventSig; // topic0 of the event; bytes32(0) = any event; FAILED_CALLS = failed calls
        bytes32 ruleHash; // keccak256 of the canonical rule JSON
        string label;
        bool active;
        uint64 at;
    }

    /// @notice eventSig used for "failed calls to this contract" watches.
    bytes32 public constant FAILED_CALLS = keccak256("ContractWatch:FailedCalls");
    uint256 public constant MAX_LABEL = 40;

    Watch[] public watches;
    mapping(address => uint256[]) internal watchesOfTarget;
    mapping(address => uint256[]) internal watchesBy;

    event Registered(uint256 indexed id, address indexed owner, address indexed target);
    event RuleUpdated(uint256 indexed id);
    event ActiveChanged(uint256 indexed id, bool active);

    error EmptyTarget();
    error BadLabel();
    error NotOwner();
    error NoWatch();

    function register(address target, uint32 chainId, bytes32 eventSig, bytes32 ruleHash, string calldata label)
        external
        returns (uint256 id)
    {
        if (target == address(0)) revert EmptyTarget();
        uint256 len = bytes(label).length;
        if (len == 0 || len > MAX_LABEL) revert BadLabel();
        id = watches.length;
        watches.push(Watch(msg.sender, target, chainId, eventSig, ruleHash, label, true, uint64(block.timestamp)));
        watchesOfTarget[target].push(id);
        watchesBy[msg.sender].push(id);
        emit Registered(id, msg.sender, target);
    }

    function updateRule(uint256 id, bytes32 ruleHash) external {
        _own(id).ruleHash = ruleHash;
        emit RuleUpdated(id);
    }

    function setActive(uint256 id, bool active) external {
        _own(id).active = active;
        emit ActiveChanged(id, active);
    }

    function getWatch(uint256 id) external view returns (Watch memory) {
        if (id >= watches.length) revert NoWatch();
        return watches[id];
    }

    function watchesFor(address target) external view returns (uint256[] memory) {
        return watchesOfTarget[target];
    }

    function watchesOf(address owner) external view returns (uint256[] memory) {
        return watchesBy[owner];
    }

    function total() external view returns (uint256) {
        return watches.length;
    }

    /// @notice Page through watches (used by the Worker and the trust strip). Returns up to `count` from `from`.
    function getWatches(uint256 from, uint256 count) external view returns (Watch[] memory out) {
        uint256 n = watches.length;
        if (from >= n) return new Watch[](0);
        uint256 end = from + count > n ? n : from + count;
        out = new Watch[](end - from);
        for (uint256 i = from; i < end; i++) out[i - from] = watches[i];
    }

    function _own(uint256 id) internal view returns (Watch storage w) {
        if (id >= watches.length) revert NoWatch();
        w = watches[id];
        if (w.owner != msg.sender) revert NotOwner();
    }
}
