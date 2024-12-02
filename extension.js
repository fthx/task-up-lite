//    Task Up Lite
//    GNOME Shell extension
//    @fthx 2024


import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';

import { Extension, gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';


const ICON_SIZE = 18; // px
const WINDOW_RAISE_DELAY = 750; // ms


const TaskButton = GObject.registerClass(
class TaskButton extends PanelMenu.Button {
    _init(window) {
        super._init();

        this._window = window;
        this._workspaceIndex = this._window.get_workspace().index();

        this.add_style_class_name('window-button');
        this._box = new St.BoxLayout({style_class: 'panel-button'});

        this._icon = new St.Icon();
        this._icon.set_icon_size(ICON_SIZE);
        this._icon.set_fallback_gicon(null);
        this._box.add_child(this._icon);

        this._label = new St.Label({y_align: Clutter.ActorAlign.CENTER});
        this._box.add_child(this._label);

        this.add_child(this._box);

        this._updateTitle();
        this._updateApp();
        this._updateFocus();
        this._updateVisibility();

        this._id = 'task-button-' + this._window;
        if (!Main.panel.statusArea[this._id])
            Main.panel.addToStatusArea(this._id, this, -1, 'left');

        global.workspace_manager.connectObject('active-workspace-changed', this._updateVisibility.bind(this), this);

        this._window.connectObject(
            'notify::appears-focused', this._updateFocus.bind(this),
            'notify::title', this._updateTitle.bind(this),
            'notify::wm-class', this._updateApp.bind(this), GObject.ConnectFlags.AFTER,
            'notify::gtk-application-id', this._updateApp.bind(this), GObject.ConnectFlags.AFTER,
            'notify::skip-taskbar', this._updateVisibility.bind(this),
            'unmanaging', this._onDestroy.bind(this),
            'workspace-changed', this._updateVisibility.bind(this),
            this);

        this.connectObject(
            'notify::hover', this._onHover.bind(this),
            'button-press-event', this._onClicked.bind(this),
            'scroll-event', this._onScroll.bind(this),
            'destroy', this._onDestroy.bind(this),
            this);
    }

    _onClicked() {
        if (this._window.has_focus()) {
            if (this._window.can_minimize() && !Main.overview.visible)
                this._window.minimize();
        } else  {
            this._window.activate(global.get_current_time());
            this._window.focus(global.get_current_time());
        }

        Main.overview.hide();
    }

    _onHover() {
        if (!this._window)
            return;

        if (this.get_hover()) {
            this._raiseWindowTimeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, WINDOW_RAISE_DELAY, () => {
                if (this.get_hover())
                        this._window.raise();

                return GLib.SOURCE_REMOVE;
            });
        } else {
            let focusWindow = global.display.get_focus_window();
            if (focusWindow)
                focusWindow.raise();

            return GLib.SOURCE_REMOVE;
        }
    }

    _onScroll(actor, event) {
        let activeWorkspace = global.workspace_manager.get_active_workspace();

        switch(event.get_scroll_direction()) {
            case Clutter.ScrollDirection.DOWN:
            case Clutter.ScrollDirection.RIGHT:
                activeWorkspace.get_neighbor(Meta.MotionDirection.RIGHT).activate(event.get_time());
                break;
            case Clutter.ScrollDirection.UP:
            case Clutter.ScrollDirection.LEFT:
                activeWorkspace.get_neighbor(Meta.MotionDirection.LEFT).activate(event.get_time());
                break;
        }
    }

    _updateTitle() {
        this._label.set_text(this._window.get_title());
    }

    _updateApp() {
        this._app = Shell.WindowTracker.get_default().get_window_app(this._window);

        if (this._app)
            this._icon.set_gicon(this._app.get_icon());
    }

    _updateFocus() {
        if (this._window.has_focus()) {
            this.remove_style_class_name('window-unfocused');
            this.add_style_class_name('window-focused');
        } else {
            this.remove_style_class_name('window-focused');
            this.add_style_class_name('window-unfocused');
        }
    }

    _updateVisibility() {
        let activeWorkspace = global.workspace_manager.get_active_workspace();
        let windowIsOnActiveWorkspace = this._window.located_on_workspace(activeWorkspace);

        this.visible = !this._window.is_skip_taskbar() && windowIsOnActiveWorkspace;
    }

    _onDestroy() {
        if (this._raiseWindowTimeout) {
            GLib.source_remove(this._raiseWindowTimeout);
            this._raiseWindowTimeout = null;
        }

        global.workspace_manager.disconnectObject(this);
        if (this._window)
            this._window.disconnectObject(this);

        super.destroy();
    }
});

const TaskBar = GObject.registerClass(
class TaskBar extends GObject.Object {
    _init() {
        Main.panel._leftBox.add_style_class_name('leftbox-reduced-padding');

        this._makeTaskbar();
        this._connectSignals();
    }

    _makeTaskButton(window) {
        if (!window || window.is_skip_taskbar() || window.get_window_type() == Meta.WindowType.MODAL_DIALOG)
            return;

        new TaskButton(window);
    }

    _destroyTaskbar() {
        for (let bin of Main.panel._leftBox.get_children()) {
            let button = bin.first_child;

            if (button instanceof TaskButton) {
                button.destroy();
                button = null;
            }
        }
    }

    _makeTaskbar() {
        this._showPlacesIcon(true);
        this._moveDate(true);

        this._makeTaskbarTimeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 300, () => {
            let workspacesNumber = global.workspace_manager.n_workspaces;

            for (let workspaceIndex = 0; workspaceIndex < workspacesNumber; workspaceIndex++) {
                let workspace = global.workspace_manager.get_workspace_by_index(workspaceIndex);
                let windowsList = workspace.list_windows();

                for (let window of windowsList)
                    this._makeTaskButton(window);
            }

            return GLib.SOURCE_REMOVE;
        });
    }

    _showPlacesIcon(show) {
        let placesIndicator = Main.panel.statusArea['places-menu'];

        if (placesIndicator) {
            placesIndicator.remove_child(placesIndicator.first_child);

            if (show) {
                let placesIcon = new St.Icon({icon_name: 'folder-symbolic', style_class: 'system-status-icon'});
                placesIndicator.add_child(placesIcon);
            } else {
                let placesLabel = new St.Label({text: _('Places'), y_expand: true, y_align: Clutter.ActorAlign.CENTER});
                placesIndicator.add_child(placesLabel);
            }
        }
    }

    _moveDate(active) {
        if (Main.sessionMode.isLocked)
            return;

        if (active) {
            Main.sessionMode.panel.center = Main.sessionMode.panel.center.filter(item => item != 'dateMenu')
            Main.sessionMode.panel.right.splice(-1, 0, 'dateMenu');
        } else {
            Main.sessionMode.panel.right = Main.sessionMode.panel.right.filter(item => item != 'dateMenu')
            Main.sessionMode.panel.center.push('dateMenu');
        }

        Main.panel._updatePanel();
    }

    _connectSignals() {
        global.display.connectObject('window-created', (display, window) => this._makeTaskButton(window), this);

        Main.extensionManager.connectObject('extension-state-changed', () => this._showPlacesIcon(true), this);
    }

    _disconnectSignals() {
        Main.extensionManager.disconnectObject(this);

        global.display.disconnectObject(this);
    }

    _destroy() {
        if (this._makeTaskbarTimeout) {
            GLib.source_remove(this._makeTaskbarTimeout);
            this._makeTaskbarTimeout = null;
        }

        this._disconnectSignals();
        this._destroyTaskbar();

        Main.panel._leftBox.remove_style_class_name('leftbox-reduced-padding');
        this._showPlacesIcon(false);
        this._moveDate(false);
    }
});

export default class TaskUpLiteExtension extends Extension {
    constructor(metadata) {
        super(metadata);
    }

    enable() {
        this._taskbar = new TaskBar();
    }

    disable() {
        this._taskbar._destroy();
        this._taskbar = null;
    }
}
