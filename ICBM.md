# Outdated ICBM Information

### Prefill Agreements

Run

```
yarn prefillAgreements
```

In order to prefill legal Agreements with correct addresses of contracts and roles. The script
automatically fills both `NEUMARK TOKEN HOLDER AGREEMENT` and `RESERVATION AGREEMENT` with correct
addresses for

- Neumark contract address
- Commitment contract Address
- PLATFORM_OPERATOR_REPRESENTATIVE

### Upload files to IPFS

run

```
yarn uploadAgreements <IPFS node address> [filePath1,filePath2 ...]
```

In order to upload files to IPFS you can run this script, you must provide an IPFS node address.
This tool will use IPFS api in order to upload files to IPFS You can leave files empty to upload
default files

Currently default files are

`./legal/NEUMARK TOKEN HOLDER AGREEMENT.out`

`./legal/RESERVATION AGREEMENT.out`
