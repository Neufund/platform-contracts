#!/usr/bin/env bash
yarn ganache-cli \
--deterministic --gasLimit 6800000 --networkId 17 -h localhost \
--account="0x2a9f4a59835a4cd455c9dbe463dcdf1b11b937e610d005c6b46300f0fa98d0b1, 1000000000000000000000000" 

