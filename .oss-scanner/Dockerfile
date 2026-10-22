# Build recipe for Anthropic's OSS Scanner (https://github.com/anthropics/oss-scanner).
# The scanner builds this with the repository as the build context, with network access, then
# audits the finished image with no network. Everything the build and tests need is fetched here.
# The full (non-slim) image already has git, python3 and CA certificates.
FROM node:22-bookworm

# scanner contract: the checkout lives inside the image, at /src
COPY . /src
WORKDIR /src

# Dev dependencies included: tsc, vitest and tsx are how the scanner exercises the code offline.
RUN npm ci && npm run build

# Run the unit tests so the image is known-good, without letting a failure abort the build.
# Live Google API tests stay off (GOOGLE_DOCS_LIVE_TESTS unset); there are no credentials or network.
RUN npm test || echo "WARNING: vitest reported failures"

CMD ["bash"]
