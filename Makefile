help:
	@echo "container - builds development/testing container"

container:
	docker build . -t neufund/platform-contracts
