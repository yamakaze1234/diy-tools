"""Keep saved logins while disabling WebView2's other form suggestions."""

import json
import logging
import threading

from common import atomic, dumps


def disable_saved_form_info(window, runtime_file):
    # webview.start runs this callback off the WinForms UI thread.
    if not window.events.loaded.wait(30):
        logging.warning('WebView2 did not load; form autofill was not configured')
        return

    from System import Action
    from Microsoft.Web.WebView2.Core import CoreWebView2BrowsingDataKinds

    ready = threading.Event()
    state = {}

    def configure():
        try:
            profile = window.native.browser.webview.CoreWebView2.Profile
            profile.IsGeneralAutofillEnabled = False
            profile.IsPasswordAutosaveEnabled = True
            state['clear_task'] = profile.ClearBrowsingDataAsync(CoreWebView2BrowsingDataKinds.GeneralAutofill)
        except Exception as error:
            state['error'] = error
        finally:
            ready.set()

    window.native.BeginInvoke(Action(configure))
    if not ready.wait(15):
        logging.warning('WebView2 form autofill configuration timed out')
        return
    if 'error' in state:
        logging.error('WebView2 form autofill configuration failed: %s', state['error'])
        return
    try:
        if not state['clear_task'].Wait(15000):
            logging.warning('WebView2 saved form information cleanup timed out')
            return
    except Exception:
        logging.exception('WebView2 saved form information cleanup failed')
        return

    runtime = json.loads(runtime_file.read_text(encoding='utf-8'))
    runtime['generalAutofillDisabled'] = True
    runtime['passwordAutosaveEnabled'] = True
    runtime['savedFormInfoCleared'] = True
    atomic(runtime_file, dumps(runtime))
