pragma solidity 0.4.26;

import "./ESOPTypes.sol";


contract EmployeesList is ESOPTypes {

    ////////////////////////
    // Mutable state
    ////////////////////////

    // employee storage
    mapping (address => Employee) private _employees;
    // employee iterator
    address[] private _addresses;

    ////////////////////////
    // Public functions
    ////////////////////////

    function getEmployeeAddresses()
        public
        constant
        returns (address[])
    {
        return _addresses;
    }

    function getEmployee(address e)
        public
        constant
        returns (
            uint32 issueDate,
            uint32 timeToSign,
            uint32 terminatedAt,
            uint32 fadeoutStarts,
            uint32 suspendedAt,
            EmployeeState state,
            uint96 poolOptions,
            uint96 extraOptions,
            uint96 exercisedOptions,
            bool acceleratedVestingBonusTriggered
        )
    {
        Employee storage employee = _employees[e];
        require(employee.idx > 0, "NF_ESOP_UNKEMPLOYEE");

        return (
            employee.issueDate,
            employee.timeToSign,
            employee.terminatedAt,
            employee.fadeoutStarts,
            employee.suspendedAt,
            employee.state,
            employee.poolOptions,
            employee.extraOptions,
            employee.exercisedOptions,
            employee.acceleratedVestingBonusTriggered
        );
    }

    function hasEmployee(address e)
        public
        constant
        returns (bool)
    {
        // this is very inefficient - whole word is loaded just to check this
        return _employees[e].idx != 0;
    }

    ////////////////////////
    // Internal functions
    ////////////////////////

    function setEmployee(
        address e,
        Employee memory employee
    )
        internal
        returns (bool isNew)
    {
        uint16 empIdx = _employees[e].idx;
        if (empIdx == 0) {
            // new element
            uint256 s = _addresses.length;
            assert(s < 0xFFFF);
            isNew = true;
            empIdx = uint16(s + 1);
            _addresses.push(e);
        } else {
            isNew = false;
        }
        // write in one go so storage is optimized
        _employees[e] = employee;
    }

    function setFadeoutStarts(address e, uint32 fadeoutStarts)
        internal
    {
        // assert(_employees[e].idx > 0);
        _employees[e].fadeoutStarts = fadeoutStarts;
    }

    function removeEmployee(address e)
        internal
        returns (bool)
    {
        uint16 empIdx = _employees[e].idx;
        if (empIdx > 0) {
            delete _employees[e];
            delete _addresses[empIdx-1];
            return true;
        }
        return false;
    }

    function terminateEmployee(address e, uint32 issueDate, uint32 terminatedAt, uint32 fadeoutStarts, EmployeeState state)
        internal
    {
        assert(state == EmployeeState.Terminated);
        // get storage reference
        Employee storage employee = _employees[e];
        // write changes in one go
        employee.state = state;
        employee.issueDate = issueDate;
        employee.terminatedAt = terminatedAt;
        employee.fadeoutStarts = fadeoutStarts;
        employee.suspendedAt = 0;
    }

    function loadEmployee(address e)
        internal
        constant
    returns (Employee storage)
    {
        return _employees[e];
    }

    function loadEmployeeAddresses()
        internal
        constant
    returns (address[] storage)
    {
        return _addresses;
    }
}
