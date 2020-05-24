pragma solidity 0.4.26;


contract ESOPTypes {

    ////////////////////////
    // Types
    ////////////////////////

    // enums are numbered starting from 0. NotSet is used to check for non existing mapping
    enum EmployeeState {
        NotSet,
        WaitingForSignature,
        Employed,
        Terminated,
        OptionsExercised
    }

    // please note that 32 bit unsigned int is used to represent UNIX time which is enough to represent dates until Sun, 07 Feb 2106 06:28:15 GMT
    // storage access is optimized so struct layout is important
    // please note that options are indivisible and not transferable
    struct Employee {
        // when vesting starts
        uint32 issueDate;
        // wait for employee signature until that time
        uint32 timeToSign;
        // date when employee was terminated, 0 for not terminated
        uint32 terminatedAt;
        // when fade out starts, 0 for not set, initally == terminatedAt
        // used only when calculating options returned to pool
        uint32 fadeoutStarts;
        // time at which employee got suspended, 0 - not suspended
        uint32 suspendedAt;
        // what is employee current status, takes 8 bit in storage
        EmployeeState state;
        // index in iterable mapping
        uint16 idx;
        // poolOptions employee gets (exit bonus not included)
        uint96 poolOptions;
        // extra options employee gets (neufund will not this option)
        uint96 extraOptions;
        // options exercised if conversion contract allows for partial conversion
        uint96 exercisedOptions;
        // were bonus options triggered when user converted
        bool acceleratedVestingBonusTriggered;
        // still free
        // 39 bits

    }
}
