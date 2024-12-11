//    Task Up Lite
//    GNOME Shell extension
//    @fthx 2024


import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';

import { AppMenu } from 'resource:///org/gnome/shell/ui/appMenu.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { ANIMATION_TIME } from 'resource:///org/gnome/shell/ui/overview.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';


const WINDOW_THUMBNAIL_RAISE_DELAY = 500; // ms
const WINDOW_THUMBNAIL_SIZE_RATIO = 0.25; // 0...1
const WINDOW_THUMBNAIL_Y_OFFSET = 6; // px
const UNFOCUSED_BUTTON_OPACITY = 128; // 0...255

const TaskButton = GObject.registerClass(
class TaskButton extends PanelMenu.Button {
    _init(window) {
        super._init();

        this._window = window;
        this._workspaceIndex = this._window.get_workspace().index();

        this.add_style_class_name('window-button');
        this._makeButtonBox();

        this._updateApp();
        this._updateFocus();
        this._updateTitle();
        this._updateVisibility();

        this._buttonEaseIn();

        this._connectSignals();
    }

    _connectSignals() {
        global.workspace_manager.connectObject('active-workspace-changed', this._updateVisibility.bind(this), this);
        Main.overview.connectObject(
            'showing', () => this.hide(),
            'hidden', this._updateVisibility.bind(this),
            this);

        this._window.connectObject(
            'notify::appears-focused', this._updateFocus.bind(this),
            'notify::title', this._updateTitle.bind(this),
            'notify::wm-class', this._updateApp.bind(this), GObject.ConnectFlags.AFTER,
            'notify::gtk-application-id', this._updateApp.bind(this), GObject.ConnectFlags.AFTER,
            'notify::skip-taskbar', this._updateVisibility.bind(this),
            'workspace-changed', this._updateVisibility.bind(this),
            'unmanaging', this._destroy.bind(this),
            this);

        this.connectObject(
            'notify::hover', this._onHover.bind(this),
            'button-press-event', (widget, event) => this._onClicked(event),
            this);
    }

    _disconnectSignals() {
        global.workspace_manager.disconnectObject(this);
        Main.overview.disconnectObject(this);

        if (this._window)
            this._window.disconnectObject(this);
    }

    _makeButtonBox() {
        this._box = new St.BoxLayout({style_class: 'panel-button'});

        this._icon = new St.Icon();
        this._icon.set_icon_size(Main.panel.height / 2);
        this._icon.set_fallback_gicon(null);
        this._box.add_child(this._icon);

        this._label = new St.Label({y_align: Clutter.ActorAlign.CENTER});
        this._box.add_child(this._label);

        this.add_child(this._box);

        this.setMenu(new AppMenu(this));
    }

    _buttonEaseIn() {
        this.set_opacity(0);

        this._id = 'task-button-' + this._window;
        if (!Main.panel.statusArea[this._id])
            Main.panel.addToStatusArea(this._id, this, -1, 'left');

        this.remove_all_transitions();
        this.ease({
            opacity: 255,
            duration: 2 * ANIMATION_TIME,
            mode: Clutter.AnimationMode.EASE_IN_QUAD,
        });
    }

    _buttonEaseOutAndDestroy() {
        this.remove_all_transitions();
        this.ease({
            opacity: 0,
            duration: ANIMATION_TIME,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onComplete: () => {
                this.ease({
                    width: 0,
                    duration: ANIMATION_TIME,
                    mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                    onComplete: () => this.destroy(),
                });
            },
        });
    }

    _onStyleChanged() {
        // withdraw -minimum-hpadding change of original PanelMenu.Button function
        // needed for the width-animation on destroy to not step at the end
    }

    _onClicked(event) {
        this._removeWindowThumbnail();

        if (event.get_button() == Clutter.BUTTON_PRIMARY) {
            this.menu.close();

            if (this._window.has_focus()) {
                if (this._window.can_minimize() && !Main.overview.visible)
                    this._window.minimize();
            } else  {
                this._window.activate(global.get_current_time());
                this._window.focus(global.get_current_time());
            }

            Main.overview.hide();

            return Clutter.EVENT_STOP;
        }

        return Clutter.EVENT_PROPAGATE;
    }

    _makeWindowThumbnail() {
        let windowActor = this._window.get_compositor_private();
        if (!windowActor)
            return;

        let [buttonX, buttonY] = this.get_transformed_position();
        let [windowWidth, windowHeight] = windowActor.get_size();
        const {scaleFactor} = St.ThemeContext.get_for_stage(global.stage);
        
        let workArea = Main.layoutManager.getWorkAreaForMonitor(Main.layoutManager.primaryIndex);

        let cloneMaxLength, cloneWidth, cloneHeight;
        if (windowWidth > windowHeight) {
            cloneMaxLength = workArea.width * WINDOW_THUMBNAIL_SIZE_RATIO;
            cloneWidth = cloneMaxLength;
            cloneHeight = cloneWidth * windowHeight / windowWidth;
        } else {
            cloneMaxLength = workArea.height * WINDOW_THUMBNAIL_SIZE_RATIO;
            cloneHeight = cloneMaxLength;
            cloneWidth = cloneHeight * windowWidth / windowHeight;
        }

        let windowClone = new Clutter.Clone({
            source: windowActor,
            width: cloneWidth * scaleFactor,
            height: cloneHeight * scaleFactor,
        });

        this._windowThumbnail = new St.Widget({
            x: buttonX,
            y: buttonY + Main.panel.height + WINDOW_THUMBNAIL_Y_OFFSET,
            opacity: 0,
        });

        this._windowThumbnail.add_child(windowClone);

        Main.uiGroup.add_child(windowThumbnail);

        this._windowThumbnail.ease({
            opacity: 255,
            duration: ANIMATION_TIME,
            mode: Clutter.AnimationMode.EASE_IN_QUAD,
        });
    }

    _removeWindowThumbnail() {
        if (!this._windowThumbnail)
            return;

        this._windowThumbnail.ease({
            opacity: 0,
            duration: ANIMATION_TIME,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onComplete: () => {
                Main.uiGroup.remove_child(this._windowThumbnail);
                this._windowThumbnail.destroy();
                this._windowThumbnail = null;
            }
        });
    }

    _removeRaiseWindowThumbnailTimeout() {
        if (this._raiseWindowThumbnailTimeout) {
            GLib.Source.remove(this._raiseWindowThumbnailTimeout);
            this._raiseWindowThumbnailTimeout = null;
        }
    }

    _onHover() {
        if (!this._window)
            return;

        if (this.get_hover()) {
            this._raiseWindowThumbnailTimeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, WINDOW_THUMBNAIL_RAISE_DELAY, () => {
                if (this.get_hover()) {
                    if (!this._window.has_focus())
                        this._makeWindowThumbnail();
                }

                this._removeRaiseWindowThumbnailTimeout();
            });
        } else {
            this._removeRaiseWindowThumbnailTimeout();
            this._removeWindowThumbnail();
        }
    }

    _updateFocus() {
        if (this._window.has_focus())
            this._box.set_opacity(255);
        else
            this._box.set_opacity(UNFOCUSED_BUTTON_OPACITY);
    }

    _updateTitle() {
        this._label.set_text(this._window.get_title());
    }

    _updateApp() {
        this._app = Shell.WindowTracker.get_default().get_window_app(this._window);

        if (this._app) {
            this._icon.set_gicon(this._app.get_icon());
            this.menu.setApp(this._app);
        }
    }

    _updateVisibility() {
        let activeWorkspace = global.workspace_manager.get_active_workspace();
        let windowIsOnActiveWorkspace = this._window.located_on_workspace(activeWorkspace);

        this.visible = !Main.overview.visible && !this._window.is_skip_taskbar() && windowIsOnActiveWorkspace;
    }

    _destroy() {
        this._removeRaiseWindowThumbnailTimeout();
        this._removeWindowThumbnail();

        this._disconnectSignals();

        this._buttonEaseOutAndDestroy();
    }
});

const TaskBar = GObject.registerClass(
class TaskBar extends GObject.Object {
    _init() {
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
                button._destroy();
                button = null;
            }
        }
    }

    _makeTaskbar() {
        this._moveDate(true);
        this._movePlacesMenu(true);

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

    _movePlacesMenu(active) {
        let placesIndicator = Main.panel.statusArea['places-menu'];
        if (!placesIndicator)
            return;

        let placesIndicatorBin = placesIndicator.get_parent();

        if (active) {
            if (!Main.panel._leftBox.get_children().includes(placesIndicatorBin))
                return;

            Main.panel._leftBox.remove_child(placesIndicatorBin);
            Main.panel._rightBox.insert_child_at_index(placesIndicatorBin, 0);
        } else {
            if (!Main.panel._rightBox.get_children().includes(placesIndicatorBin))
                return;

            Main.panel._rightBox.remove_child(placesIndicatorBin);
            Main.panel._leftBox.add_child(placesIndicatorBin);
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
        Main.panel.connectObject('scroll-event', (actor, event) => Main.wm.handleWorkspaceScroll(event), this);

        Main.extensionManager.connectObject('extension-state-changed', () => this._movePlacesMenu(true), this);
    }

    _disconnectSignals() {
        Main.extensionManager.disconnectObject(this);

        global.display.disconnectObject(this);
        Main.panel.disconnectObject(this);
    }

    _destroy() {
        this._disconnectSignals();

        if (this._makeTaskbarTimeout) {
            GLib.Source.remove(this._makeTaskbarTimeout);
            this._makeTaskbarTimeout = null;
        }

        this._destroyTaskbar();

        Main.panel._leftBox.remove_style_class_name('leftbox-reduced-padding');
        this._movePlacesMenu(false);
        this._moveDate(false);
    }
});

export default class TaskUpLiteExtension {
    enable() {
        this._taskbar = new TaskBar();
    }

    disable() {
        this._taskbar._destroy();
        this._taskbar = null;
    }
}
