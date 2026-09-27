"""Synthetic desktop; only the OS folder picker is replaced for automation."""
import os
import webview


def choose_folder(self, dialog_type, *args, **kwargs):
    assert dialog_type == webview.FileDialog.FOLDER
    return (os.environ['DIY_TEST_EXPORT_DIRECTORY'],)


webview.Window.create_file_dialog = choose_folder
import desktop_harness  # Runs the existing synthetic cloud/ERP desktop fixture.
