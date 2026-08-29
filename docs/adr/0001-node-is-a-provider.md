# Node is a provider, not a protocol UI

The tracer (and v1) treats a **node** as an email provider: domain, SMTP, and its own web app. Users do not use one UI against many nodes. Portability is: opt into another node, open *that* node's UI, see the same **mailbox** because every node reads the shared **DAL**. The alternative — a protocol client that talks to index + blobs with no node in the middle — was rejected as not how operators or users will work.
