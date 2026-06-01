# Portable Demo Runtime Job

This fixture is the only runtime job intentionally allowed by `.gitignore`.
It represents a cancelled CellUniverse fluo run for frontend/backend debugging.

The original source run was:

`/run/media/blue-lobster/disk3/celluniverse_output/outputs_fluo/output_ubuntu_fluo_0-200_trash_labeled_20260531_051107`

To keep the repository portable, this fixture commits cached point-cloud previews
and downsampled 2D TIFF previews for frames 0-19. The original full-resolution
TIFF stacks are intentionally omitted.
