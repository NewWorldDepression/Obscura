ARG BASE_IMAGE
FROM $BASE_IMAGE
MAINTAINER Mike Hommey <mhommey@mozilla.com>

ENV DEBIAN_FRONTEND=noninteractive

# Set a default command useful for debugging
CMD ["/bin/bash", "--login"]

# %include taskcluster/docker/recipes/setup_packages.sh
COPY topsrcdir/taskcluster/docker/recipes/setup_packages.sh /usr/local/sbin/
# %include taskcluster/docker/recipes/clean_packages.sh
COPY topsrcdir/taskcluster/docker/recipes/clean_packages.sh /usr/local/sbin/

COPY taskcluster-hack.sh /usr/local/sbin
COPY snapshot-hack.py /usr/local/sbin
COPY gpgvnoexpkeysig /usr/local/sbin

ARG DIST
ARG SNAPSHOT
ARG TASKCLUSTER_ROOT_URL

RUN if [ -f /etc/apt/sources.list.d/ubuntu.sources ]; then mv /etc/apt/sources.list.d/ubuntu.sources /etc/apt/; fi;

# Set apt sources list to a snapshot.
# Note: the use of gpgvnoexpkeysig is because the Debian Jessie GPG key expired.
RUN if [ -n "$DIST" ]; then for s in debian_$DIST debian_$DIST-updates debian_$DIST-backports debian-security_$DIST-security debian-debug_$DIST-debug debian-debug_$DIST-proposed-updates-debug debian-debug_$DIST-backports-debug; do \
      case "$s" in \
      debian-debug_jessie*|debian_jessie-updates) \
          : No debian-debug/updates archive for Jessie; \
          ;; \
      debian-security_jessie-security) \
          echo "deb http://archive.debian.org/debian-security/ jessie/updates main"; \
          ;; \
      debian-security_buster-security) \
          echo "deb http://archive.debian.org/debian-security/ buster/updates main"; \
          ;; \
      debian*_jessie*|debian*_buster*) \
          echo "deb http://archive.debian.org/${s%_*}/ ${s#*_} main"; \
          ;; \
      *) \
          echo "deb http://snapshot.debian.org/archive/${s%_*}/$SNAPSHOT/ ${s#*_} main"; \
          ;; \
      esac; \
    done > /etc/apt/sources.list ; fi && \
    rm -f /etc/apt/sources.list.d/* && \
    ( echo 'quiet "true";'; \
      echo 'APT::Get::Assume-Yes "true";'; \
      echo 'APT::Install-Recommends "false";'; \
      echo 'Acquire::Check-Valid-Until "false";'; \
      echo 'Acquire::Retries "5";'; \
      if dpkg --compare-versions $(apt --version | awk '{print $2}') ge 2.1.15; then \
        echo 'dir::bin::methods::https "/usr/local/sbin/taskcluster-hack.sh";'; \
      fi; \
      if [ "$DIST" = "jessie" ]; then \
        echo 'Dir::Bin::gpg "/usr/local/sbin/gpgvnoexpkeysig";'; \
      fi; \
    ) > /etc/apt/apt.conf.d/99taskcluster && \
    ( echo 'Package: *'; \
      echo 'Pin: origin "'$TASKCLUSTER_ROOT_URL'"' | sed 's,https://,,'; \
      echo 'Pin-Priority: 1001'; \
    ) > /etc/apt/preferences.d/99taskcluster

RUN if [ -f /etc/apt/ubuntu.sources ]; then mv /etc/apt/ubuntu.sources /etc/apt/sources.list.d/; fi;

RUN apt-get update && \
    if grep -q snapshot.debian.org /etc/apt/sources.list; then \
      apt-get install python3-minimal libpython3-stdlib; \
      echo 'dir::bin::methods::http "/usr/local/sbin/snapshot-hack.py";' >> /etc/apt/apt.conf.d/99taskcluster; \
    fi && \
    apt-get dist-upgrade && \
    apt-get install \
      apt-transport-https \
      ca-certificates
